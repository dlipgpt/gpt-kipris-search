import { GoogleSpreadsheet } from 'google-spreadsheet';

async function handler(req, res) {
  // POST 메서드만 처리
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET requests allowed' });
  }

  try {
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

    // 서비스 계정 인증
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });

    // 구글 시트 문서 불러오기
    await doc.loadInfo();

    // 'result' 시트 선택
    const sheet = doc.sheetsByTitle['result'];

    // 시트에서 모든 데이터 가져오기
    const rows = await sheet.getRows();

    // 성공적으로 데이터를 불러오면 JSON 형식으로 반환
    res.status(200).json(rows);
  } catch (error) {
    console.error('[ERROR] Failed to fetch data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
}

export default handler;
