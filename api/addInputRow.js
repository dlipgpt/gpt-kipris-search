import { GoogleSpreadsheet } from 'google-spreadsheet';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { baseTrademark, searchQuery } = req.body;

  if (!baseTrademark || !searchQuery) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

    await doc.useServiceAccountAuth({
      client_email: credentials.client_email,
      private_key: credentials.private_key.replace(/\\n/g, '\n'),
    });

    await doc.loadInfo();

    const sheet = doc.sheetsByTitle['input'];
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    const newSearchId = rows.length > 0 ? parseInt(rows[rows.length - 1].searchId) + 1 : 1;

    await sheet.addRow({
      searchId: newSearchId,
      baseTrademark,
      searchQuery,
      runStatus: 'Y',
      createdAt: new Date().toISOString().split('T')[0],
      processedAt: '',
    });

    res.status(200).json({ message: 'Row added successfully', searchId: newSearchId });
  } catch (error) {
    console.error('[ERROR] Failed to add row to Google Sheets:', error);
    res.status(500).json({
      error: 'Failed to add row to Google Sheets',
      details: error.message,
    });
  }
}
