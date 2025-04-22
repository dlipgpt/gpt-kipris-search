// api/search.js
const { google } = require('googleapis');
const axios = require('axios');

// 환경변수
const SERVICE_ACCOUNT = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
const SHEET_ID        = process.env.GOOGLE_SHEET_ID;
const SERVICE_KEY     = process.env.KIPRIS_SERVICE_KEY;

// 시트 이름
const INPUT_SHEET  = 'input';
const RESULT_SHEET = 'result';

// Google Sheets 클라이언트 생성
async function getSheetsClient() {
  const jwt = new google.auth.JWT({
    email: SERVICE_ACCOUNT.client_email,
    key: SERVICE_ACCOUNT.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  await jwt.authorize();
  return google.sheets({ version: 'v4', auth: jwt });
}

// 검색식 파싱 (TN, TC, SC)
function parseSearchQuery(q) {
  const out = { trademarkNames: [], classifications: [], similarityCodes: [] };
  const mTN = q.match(/TN=\[([^\]]+)\]/);
  if (mTN) out.trademarkNames = mTN[1].split('+');
  const mTC = q.match(/TC=\[([^\]]+)\]/);
  if (mTC) out.classifications = mTC[1].split('+');
  const mSC = q.match(/SC=\[([^\]]+)\]/);
  if (mSC) out.similarityCodes = mSC[1].split('+');
  return out;
}

// KIPRIS 전체검색 호출
async function searchKipris({ trademarkName, classification, similarityCode }) {
  const url = 'http://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService/getAdvancedSearch';
  const params = {
    trademarkName,
    classification,
    similarityCode,
    application: true,
    registration: true,
    refused: true,
    expiration: true,
    withdrawal: true,
    publication: true,
    cancel: true,
    abandonment: true,
    trademark: true,
    serviceMark: true,
    trademarkServiceMark: true,
    businessEmblem: true,
    collectiveMark: true,
    geoOrgMark: true,
    internationalMark: true,
    certMark: true,
    geoCertMark: true,
    character: true,
    figure: true,
    compositionCharacter: true,
    figureComposition: true,
    sound: true,
    fragrance: true,
    color: true,
    dimension: true,
    colorMixed: true,
    hologram: true,
    motion: true,
    visual: true,
    invisible: true,
    pageNo: 1,
    numOfRows: 30,
    ServiceKey: SERVICE_KEY,
    _type: 'json'
  };
  const resp = await axios.get(url, { params, timeout: 20000 });
  // 응답에서 items.item 배열 추출
  const body = resp.data.response?.body;
  const items = body?.items?.item ?? [];
  return Array.isArray(items) ? items : [items];
}

// 핸들러
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  const searchId = String(req.query.searchId || '').trim();
  if (!searchId) {
    res.status(400).json({ error: 'searchId is required' });
    return;
  }

  const sheets = await getSheetsClient();

  // 1) input 시트 읽기 (A:searchId, B:query, C:runStatus, D:processedAt)
  const read = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${INPUT_SHEET}!A2:D`
  });
  const rows = read.data.values || [];
  let targetRow, rowNum;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === searchId && String(rows[i][2]).toUpperCase() === 'Y') {
      targetRow = rows[i];
      rowNum = i + 2; // 실제 시트 행 번호
      break;
    }
  }
  if (!targetRow) {
    res.status(400).json({ error: '대기 중인 searchId가 아닙니다.' });
    return;
  }

  const rawQuery = targetRow[1];
  const { trademarkNames, classifications, similarityCodes } = parseSearchQuery(rawQuery);

  // 2) KIPRIS API 다중 호출 → 합집합·중복 제거
  const map = {};
  for (const tn of trademarkNames) {
    for (const sc of similarityCodes) {
      for (const cls of classifications) {
        const items = await searchKipris({ trademarkName: tn, classification: cls, similarityCode: sc });
        for (const it of items) {
          map[it.applicationNumber] = {
            searchId,
            indexNo: it.indexNo,
            applicationNumber: it.applicationNumber,
            applicationDate: it.applicationDate,
            publicationNumber: it.publicationNumber,
            publicationDate: it.publicationDate,
            registrationPublicNumber: it.registrationPublicNumber,
            registrationPublicDate: it.registrationPublicDate,
            registrationNumber: it.registrationNumber,
            registrationDate: it.registrationDate,
            priorityNumber: it.priorityNumber,
            priorityDate: it.priorityDate,
            applicationStatus: it.applicationStatus,
            classificationCode: it.classificationCode,
            viennaCode: it.viennaCode,
            applicantName: it.applicantName,
            agentName: it.agentName,
            title: it.title,
            fullText: it.fullText,
            drawing: it.drawing,
            bigDrawing: it.bigDrawing,
            appReferenceNumber: it.appReferenceNumber,
            regReferenceNumber: it.regReferenceNumber,
            internationalRegisterNumber: it.internationalRegisterNumber,
            internationalRegisterDate: it.internationalRegisterDate
          };
        }
      }
    }
  }
  const results = Object.values(map);

  // 현지(한국) 시간 계산
  const nowLocal = new Date(Date.now() + 9 * 3600_000)
    .toISOString()
    .replace('T',' ')
    .slice(0,19);

  // 3) input 시트에 runStatus=N, processedAt 기록
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${INPUT_SHEET}!C${rowNum}:D${rowNum}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['N', nowLocal]] }
  });

  // 4) result 시트에 결과 append
  const out = results.map(o => [
    o.searchId,
    o.indexNo,
    o.applicationNumber,
    o.applicationDate,
    o.publicationNumber,
    o.publicationDate,
    o.registrationPublicNumber,
    o.registrationPublicDate,
    o.registrationNumber,
    o.registrationDate,
    o.priorityNumber,
    o.priorityDate,
    o.applicationStatus,
    o.classificationCode,
    o.viennaCode,
    o.applicantName,
    o.agentName,
    o.title,
    o.fullText,
    o.drawing,
    o.bigDrawing,
    o.appReferenceNumber,
    o.regReferenceNumber,
    o.internationalRegisterNumber,
    o.internationalRegisterDate,
    nowLocal
  ]);
  if (out.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${RESULT_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: out }
    });
  }

  // 5) 최종 응답
  res.status(200).json({ searchId, results });
};
