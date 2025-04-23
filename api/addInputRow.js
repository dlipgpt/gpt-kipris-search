// File: api/addInputRow.js
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { baseTrademark, searchQuery } = req.body;

  if (!baseTrademark || !searchQuery) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // 인증 정보는 환경 변수에서 불러옴
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet('1q2AWZAKVoMDIVpl2nbxvmgAbmjjEA2bR83_4mW_FGBk');
    await doc.useAuthClient(serviceAccountAuth);
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

    res.status(200).json({ message: 'Row added successfully' });
  } catch (error) {
    console.error('Error adding row:', error);
    res.status(500).json({ error: 'Failed to add row' });
  }
}
