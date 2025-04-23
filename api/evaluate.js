import { GoogleSpreadsheet } from "google-spreadsheet";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST 방식만 허용됩니다." });
    }

    const { searchId, evaluations } = req.body;
    if (!searchId || !Array.isArray(evaluations)) {
      return res.status(400).json({ error: "searchId와 evaluations 배열이 필요합니다." });
    }

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth(
      JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS)
    );
    await doc.loadInfo();

    const resultSheet = doc.sheetsByTitle["result"];
    await resultSheet.loadHeaderRow();
    const rows = await resultSheet.getRows();

    let updated = 0;
    for (const r of rows) {
      const matched = evaluations.find(e =>
        String(e.applicationNumber) === String(r.applicationNumber) &&
        String(r.searchId) === String(searchId)
      );
      if (matched) {
        r.evaluation = matched.evaluation;
        await r.save();
        updated++;
      }
    }

    return res.status(200).json({ updated });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "서버 오류 발생", detail: err.message });
  }
}
