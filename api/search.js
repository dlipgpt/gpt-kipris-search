// api/search.js
import { google } from 'googleapis';
import axios from 'axios';

const creds = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
const authClient = new google.auth.JWT(
  creds.client_email, null, creds.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

// 검색식 파싱
function parseSearchQuery(q) {
  const tn = (q.match(/TN=\[([^\]]+)\]/) || [])[1]?.split('+') || [];
  const tc = (q.match(/TC=\[([^\]]+)\]/) || [])[1]?.split('+') || [];
  const sc = (q.match(/SC=\[([^\]]+)\]/) || [])[1]?.split('+') || [];
  return { trademarkNames: tn, productClasses: tc, similarGroupCodes: sc };
}

export default async function handler(req, res) {
  const debugLogs = [];
  const { searchId } = req.query;
  debugLogs.push(`[start] handler for searchId=${searchId}`);

  try {
    // 1. 인증
    await authClient.authorize();
    debugLogs.push('[step1] Google Sheets auth done');

    const sheets = google.sheets('v4');

    // 2. input 시트 읽기
    const inResp = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'input!A:C',
    });
    const rows = inResp.data.values || [];
    debugLogs.push(`[step2] read input sheet, rows=${rows.length}`);

    // 3. 찾기
    const rowIdx = rows.findIndex(r => String(r[0]) === String(searchId) && r[2] === 'Y');
    if (rowIdx === -1) {
      debugLogs.push('[error] no pending row');
      return res.status(404).json({ error: '실행 대기 중인 searchId가 아닙니다.', debugLogs });
    }
    const query = rows[rowIdx][1];
    debugLogs.push(`[step3] found row, query=${query}`);

    // 4. KIPRIS 호출
    debugLogs.push('[step4] calling KIPRIS API');
    let kiprisResp;
    try {
      kiprisResp = await axios.get('https://api.kipris.or.kr/kipo-api', {
        params: {
          tn: parseSearchQuery(query).trademarkNames.join('+'),
          tc: parseSearchQuery(query).productClasses.join('+'),
          sc: parseSearchQuery(query).similarGroupCodes.join(',')
        },
        timeout: 8000
      });
      debugLogs.push(`[step4] KIPRIS responded, items=${(kiprisResp.data.items||[]).length}`);
    } catch (e) {
      debugLogs.push(`[error] KIPRIS call failed: ${e.message}`);
      return res.status(503).json({ error: 'KIPRIS API 호출 실패', debugLogs });
    }

    const results = kiprisResp.data.items || [];

    // 5. 결과 시트에 append
    const now = new Date().toISOString().replace('T',' ').slice(0,19);
    const appendRows = results.map((item,idx)=>[
      searchId, idx+1, item.trademarkName, item.applicationNumber,
      item.applicationDate, item.registrationStatus, item.applicant,
      item.designatedGoods, item.similarGroupCode, now, ''
    ]);
    if (appendRows.length) {
      await sheets.spreadsheets.values.append({
        auth: authClient,
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'result!A:K',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: appendRows }
      });
      debugLogs.push(`[step5] appended ${appendRows.length} rows to result sheet`);
    } else {
      debugLogs.push('[step5] no results to append');
    }

    // 6. input 시트 업데이트
    await sheets.spreadsheets.values.update({
      auth: authClient,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `input!C${rowIdx+1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values:[['N']] }
    });
    debugLogs.push('[step6] runStatus updated to N');
    await sheets.spreadsheets.values.update({
      auth: authClient,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `input!E${rowIdx+1}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values:[[now]] }
    });
    debugLogs.push(`[step6] processedAt set to ${now}`);

    // 7. 응답
    debugLogs.push('[done] handler complete');
    return res.status(200).json({ searchId, results, debugLogs });

  } catch (err) {
    debugLogs.push(`[error] handler exception: ${err.message}`);
    return res.status(500).json({ error: err.message, debugLogs });
  }
}
