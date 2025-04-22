// api/search.js
import { google } from 'googleapis';
import axios from 'axios';

const creds = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
const authClient = new google.auth.JWT(
  creds.client_email,
  null,
  creds.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

function parseSearchQuery(q) {
  const tn = (q.match(/TN=\[([^\]]+)\]/) || [])[1]?.split('+') || [];
  const tc = (q.match(/TC=\[([^\]]+)\]/) || [])[1]?.split('+') || [];
  const sc = (q.match(/SC=\[([^\]]+)\]/) || [])[1]?.split('+') || [];
  return { trademarkNames: tn, productClasses: tc, similarGroupCodes: sc };
}

export default async function handler(req, res) {
  const { searchId } = req.query;
  try {
    await authClient.authorize();
    const sheets = google.sheets('v4');

    // 1) input 시트에서 해당 searchId 행 읽기
    const inResp = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'input!A:C',
    });
    const rows = inResp.data.values || [];
    const rowIdx = rows.findIndex(r => String(r[0]) === String(searchId) && r[2] === 'Y');
    if (rowIdx === -1) {
      return res.status(404).json({ error: '실행 대기 중인 searchId가 아닙니다.' });
    }
    const query = rows[rowIdx][1];

    // 2) 검색식 파싱
    const { trademarkNames, productClasses, similarGroupCodes } = parseSearchQuery(query);

    // 3) KIPRIS API 호출 (예시)
    const kiprisResp = await axios.get('https://api.kipris.or.kr/kipo-api', {
      params: {
        tn: trademarkNames.join('+'),
        tc: productClasses.join('+'),
        sc: similarGroupCodes.join(',')
      }
    });
    const results = kiprisResp.data.items || [];

    // 4) result 시트에 append
    const now = new Date().toISOString().replace('T',' ').slice(0,19);
    const appendRows = results.map((item, idx) => [
      searchId,
      idx+1,
      item.trademarkName,
      item.applicationNumber,
      item.applicationDate,
      item.registrationStatus,
      item.applicant,
      item.designatedGoods,
      item.similarGroupCode,
      now,
      ''  // evaluation은 GPTs 쪽에서 채웁니다
    ]);
    if (appendRows.length > 0) {
      await sheets.spreadsheets.values.append({
        auth: authClient,
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'result!A:K',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: appendRows }
      });
    }

    // 5) input 시트 runStatus, processedAt 업데이트
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
      requestBody: { values: [[now]] }
    });

    // 6) 응답
    return res.status(200).json({ searchId, results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
