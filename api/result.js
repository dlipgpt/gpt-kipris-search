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

    const inputSheet = doc.sheetsByTitle["input"];
    await inputSheet.loadHeaderRow();
    const inputRows = await inputSheet.getRows();
    const inputRow = inputRows.find(r => String(r.searchId) === String(searchId));
    if (!inputRow) {
      return res.status(404).json({ error: "해당 searchId의 input 항목을 찾을 수 없습니다." });
    }

    const baseTrademark = inputRow.baseTrademark || "";

    const resultSheet = doc.sheetsByTitle["result"];
    await resultSheet.loadHeaderRow();
    const resultRows = await resultSheet.getRows();

    const results = resultRows
      .filter(r => String(r.searchId) === String(searchId))
      .map(r => {
        const result = {};
        resultSheet.headerValues.forEach(key => {
          result[key] = r[key] || "";
        });
        return result;
      });

    return res.status(200).json({
      searchId,
      baseTrademark,
      results
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "서버 오류 발생", detail: err.message });
  }
}
