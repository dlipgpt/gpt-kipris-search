import { google } from 'googleapis';

const creds = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
const authClient = new google.auth.JWT(
  creds.client_email,
  null,
  creds.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

export default async function handler(req, res) {
  try {
    await authClient.authorize();
    const sheets = google.sheets('v4');

    const inputResp = await sheets.spreadsheets.values.get({
      auth: authClient,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'input!A:F', // A: searchId, B: baseTrademark, C: searchQuery, D: runStatus, E: createdAt, F: processedAt
    });
    const rows = inputResp.data.values || [];

    const pending = rows
      .filter(r => r[3] === 'Y') // D열(runStatus)이 Y인 항목만
      .map(r => ({
        searchId: r[0],         // A열
        baseTrademark: r[1] || "", // B열 ← ✅ 내가 등록하려는 상표
        searchQuery: r[2]       // C열
      }));

    res.status(200).json(pending);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
