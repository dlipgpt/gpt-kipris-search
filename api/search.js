// 1) 외부 라이브러리 로드
import { google } from 'googleapis';
import axios from 'axios';

// 2) 서비스 계정 인증 준비
const creds = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
const authClient = new google.auth.JWT(
  creds.client_email,
  null,
  creds.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

// 3) 메인 핸들러
export default async function handler(req, res) {
  try {
    // 3-1) searchId 파라미터 확인
    const { searchId } = req.query;
    if (!searchId) {
      return res.status(400).json({ error: 'searchId가 필요합니다.' });
    }

    // 3-2) Google Sheets에서 input 행 읽기
    await authClient.authorize();
    const sheets = google.sheets('v4');
    const inputResp = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'input!A:D',
    });
    const rows = inputResp.data.values || [];
    const row = rows.find(r => r[0] === searchId && r[2] === 'Y');
    if (!row) {
      return res.status(404).json({ error: '실행 대기 중인 searchId가 아닙니다.' });
    }
    const searchQuery = row[1];

    // 3-3) 검색식 파싱
    const parsed = parseSearchQuery(searchQuery);

    // 3-4) KIPRIS API 호출
    const kiprisResp = await axios.get(
      'https://kipris.or.kr/openapi/trademark/getAdvancedSearch',
      { params: { apiKey: process.env.KIPRIS_API_KEY, ...parsed } }
    );
    const results = kiprisResp.data.items || [];

    // 3-5) result 시트에 저장
    const outputValues = results.map(item => [
      searchId,
      item.trademarkName,
      item.applicationNumber,
      item.applicationDate,
      item.registrationStatus,
      item.applicant,
      item.designatedGoods,
      item.similarGroupCode,
      ''
    ]);
    await sheets.spreadsheets.values.append({
      auth: authClient,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'result!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: outputValues }
    });

    // 3-6) GPTs에 응답
    res.status(200).json({ success: true, searchId, results });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}

// 4) 검색식 파싱 함수
function parseSearchQuery(q) {
  const out = {};
  const tnMatch = q.match(/TN=\[([^\]]+)\]/);
  if (tnMatch) out.trademarkNames = tnMatch[1].split('+');
  const tcMatch = q.match(/TC=\[([^\]]+)\]/);
  if (tcMatch) out.productClasses = tcMatch[1].split('+');
  const scMatch = q.match(/SC=\[([^\]]+)\]/);
  if (scMatch) out.similarGroupCodes = scMatch[1].split('+');
  return out;
}
