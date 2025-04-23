import { GoogleSpreadsheet } from "google-spreadsheet";

export default async function handler(req, res) {
  try {
    const searchId = req.query.searchId;
    if (!searchId) {
      return res.status(400).json({ error: "searchId가 필요합니다." });
    }

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth(
      JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS)
    );
    await doc.loadInfo();

    const resultSheet = doc.sheetsByTitle["result"];
    await resultSheet.loadHeaderRow();
    const rows = await resultSheet.getRows();

    const results = rows
      .filter(r => String(r.searchId) === String(searchId))
      .map(r => {
        const obj = {};
        resultSheet.headerValues.forEach(key => {
          obj[key] = r[key] || "";
        });
        return obj;
      });

    return res.status(200).json({ searchId, results });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "서버 오류 발생", detail: err.message });
  }
}
