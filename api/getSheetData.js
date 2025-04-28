import { GoogleSpreadsheet } from 'google-spreadsheet';

export default async function handler(req, res) {
  // GET 요청만 허용
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET requests allowed' });
  }

  const { searchId } = req.query;

  try {
    // 서비스 계정 자격증명 읽기
    const creds = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

    // Google Sheets 인증
    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, '\n'),
    });
    await doc.loadInfo();

    // result 시트 불러오기
    const sheet = doc.sheetsByTitle['result'];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    // searchId가 있으면 해당 ID만 필터링
    if (searchId) {
      const matched = rows.filter(r => String(r.searchId) === String(searchId));
      if (matched.length === 0) {
        return res.status(404).json({ error: `No results found for searchId ${searchId}` });
      }

      // baseTrademark는 첫 행에서 추출
      const baseTrademark = matched[0].baseTrademark || '';

      // 헤더 기준으로 객체 맵핑
      const results = matched.map(r => {
        const obj = {};
        sheet.headerValues.forEach(h => {
          obj[h] = r[h] || '';
        });
        return obj;
      });

      return res.status(200).json({ searchId: String(searchId), baseTrademark, results });
    }

    // searchId 없으면 전체 행 반환
    const allData = rows.map(r => {
      const obj = {};
      sheet.headerValues.forEach(h => {
        obj[h] = r[h] || '';
      });
      return obj;
    });

    return res.status(200).json(allData);
  } catch (error) {
    console.error('[ERROR] getSheetData failed:', error);
    return res.status(500).json({ error: 'Failed to fetch data', detail: error.message });
  }
}
