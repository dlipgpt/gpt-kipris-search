// api/search.js
import { google } from 'googleapis';
import axios from 'axios';

// 1) Google Sheets 서비스 계정 인증
const creds = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
const authClient = new google.auth.JWT(
  creds.client_email,
  null,
  creds.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

// 2) 검색식 파싱: TN, TC, SC
function parseSearchQuery(q) {
  const getList = key => {
    const m = new RegExp(`${key}=\\[([^\\]]*)\\]`).exec(q);
    return m && m[1] ? m[1].split('+') : [];
  };
  return {
    trademarkNames: getList('TN'),            // ["콘티플","칸토플",…]
    classification: getList('TC').join('+'),  // "09+42"
    similarityCode: getList('SC').join(',')   // "G390802,S0601"
  };
}

export default async function handler(req, res) {
  const { searchId } = req.query;
  await authClient.authorize();
  const sheets = google.sheets('v4');

  // 3) input!A:C 에서 대기 상태(Y)인 searchId 찾기
  const inResp = await sheets.spreadsheets.values.get({
    auth: authClient,
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'input!A:C'
  });
  const rows = inResp.data.values || [];
  const rowIdx = rows.findIndex(r => String(r[0]) === String(searchId) && r[2] === 'Y');
  if (rowIdx === -1) {
    return res.status(404).json({ error: '대기 중인 searchId가 아닙니다.' });
  }

  const query = rows[rowIdx][1];
  const { trademarkNames, classification, similarityCode } = parseSearchQuery(query);

  // 4) getAdvancedSearch 다중 호출 & 합집합 (applicationNumber 기준 중복 제거)
  const url = 'http://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService/getAdvancedSearch';
  const allMap = {};  // { [applicationNumber]: item }

  for (const name of trademarkNames) {
    const params = {
      ServiceKey:             process.env.KIPRIS_API_KEY,
      trademarkName:          name,
      classification,
      similarityCode,
      // 필수 Boolean 플래그들 (모두 포함)
      application:      true,
      registration:     true,
      refused:          true,
      expiration:       true,
      withdrawal:       true,
      publication:      true,
      cancel:           true,
      abandonment:      true,
      trademark:        true,
      serviceMark:      true,
      trademarkServiceMark: true,
      businessEmblem:      true,
      collectiveMark:      true,
      geoOrgMark:          true,
      internationalMark:   true,
      certMark:            true,
      geoCertMark:         true,
      character:           true,
      figure:              true,
      compositionCharacter:true,
      figureComposition:   true,
      fragrance:           true,
      sound:               true,
      color:               true,
      colorMixed:          true,
      dimension:           true,
      hologram:            true,
      invisible:           true,
      motion:              true,
      visual:              true,
      // 페이징
      pageNo:    1,
      numOfRows: 50,
      _type:     'json'
    };

    try {
      const kiprisResp = await axios.get(url, { params, timeout: 8000 });
      const items = kiprisResp.data?.response?.body?.items?.item || [];
      for (const it of items) {
        const key = it.applicationNumber;
        if (key) allMap[key] = it;
      }
    } catch (e) {
      console.warn(`KIPRIS 호출 실패 (name="${name}")`, e.message);
      // 다음 name으로 계속
    }
  }

  const mergedItems = Object.values(allMap);
  const now = new Date().toISOString().replace('T',' ').slice(0,19);
  // 한국 시간 (UTC+9) 기준으로 YYYY-MM-DD HH:mm:ss 생성
  const now = new Date(Date.now() + 9 * 3600_000)
    .toISOString()
    .replace('T',' ')
    .slice(0,19);

  // 5) result 시트에 append
  if (mergedItems.length > 0) {
    const appendRows = mergedItems.map((it, idx) => [
      searchId,
      it.indexNo,
      it.applicationNumber,
      it.applicationDate,
      it.publicationNumber,
      it.publicationDate,
      it.registrationPublicNumber,
      it.registrationPublicDate,
      it.registrationNumber,
      it.registrationDate,
      it.priorityNumber,
      it.priorityDate,
      it.applicationStatus,
      it.classificationCode,
      it.viennaCode,
      it.applicantName,
      it.agentName,
      it.regPrivilegeName,
      it.title,
      it.fullText,
      it.drawing,
      it.bigDrawing,
      it.appReferenceNumber,
      it.regReferenceNumber,
      it.internationalRegisterNumber,
      it.internationalRegisterDate,
      now,
      ''  // 평가용 칼럼
    ]);

    await sheets.spreadsheets.values.append({
      auth: authClient,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'result!A:Z',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: appendRows }
    });
  }

  // 6) input 시트 runStatus=N, processedAt 업데이트
  await sheets.spreadsheets.values.update({
    auth: authClient,
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `input!C${rowIdx+1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['N']] }
  });
  await sheets.spreadsheets.values.update({
    auth: authClient,
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `input!E${rowIdx+1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values:[[now]] }
  });

  // 7) 응답
  return res.status(200).json({ searchId, results: mergedItems });
}
