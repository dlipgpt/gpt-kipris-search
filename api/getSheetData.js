import { GoogleSpreadsheet } from 'google-spreadsheet';

export default async function handler(req, res) {
  // Only GET allowed
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Only GET requests allowed' });
  }

  const { searchId } = req.query;

  try {
    // Parse service account credentials
    const creds = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

    // Authenticate with Google Sheets
    await doc.useServiceAccountAuth({
      client_email: creds.client_email,
      private_key: creds.private_key.replace(/\\n/g, '\n'),
    });
    await doc.loadInfo();

    // Access the result sheet
    const sheet = doc.sheetsByTitle['result'];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();

    // If searchId provided, filter and return structured result
    if (searchId) {
      const matched = rows.filter(r => String(r.searchId) === String(searchId));
      if (matched.length === 0) {
        return res.status(404).json({ error: `No results found for searchId ${searchId}` });
      }

      // Extract baseTrademark from first matching row
      const baseTrademark = matched[0].baseTrademark || '';

      // Map rows to objects using headerValues
      const results = matched.map(r => {
        const obj = {};
        sheet.headerValues.forEach(h => {
          obj[h] = r[h] || '';
        });
        return obj;
      });

      return res.status(200).json({ searchId: String(searchId), baseTrademark, results });
    }

    // No searchId: return all rows as array of objects
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
