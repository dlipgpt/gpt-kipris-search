import { google } from 'googleapis';

// 서비스 계정 인증 준비
const creds = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
const authClient = new google.auth.JWT(
  creds.client_email,
  null,
  creds.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

export default async function handler(req, res) {
  try {
    // 1) Google Sheets 인증
    await authClient.authorize();
    const sheets = google.sheets('v4');

    // 2) 구글 스프레드시트에서 'input' 시트 A:C (searchId, query, runStatus) 읽기
    const inputResp = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId: process.env.GOOGLE_SHEET_ID, // 환경 변수로 스프레드시트 ID 사용
      range: 'input!A:C', // 범위 설정
    });
    const rows = inputResp.data.values || [];

    // 3) runStatus='Y'인 행만 필터링
    const pending = rows
      .filter(r => r[2] === 'Y')
      .map(r => ({ searchId: r[0], searchQuery: r[1] }));

    // 4) JSON으로 반환
    res.status(200).json(pending);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
