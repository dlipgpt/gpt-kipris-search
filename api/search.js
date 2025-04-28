import { GoogleSpreadsheet } from "google-spreadsheet";
import axios from "axios";
import pLimit from "p-limit";

export default async function handler(req, res) {
  // GET만 허용
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET requests allowed" });
  }

  try {
    const searchId = req.query.searchId;
    if (!searchId) {
      return res.status(400).json({ error: "searchId가 필요합니다." });
    }

    // 1) Google Sheets 인증 및 input 로드
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth(
      JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS)
    );
    await doc.loadInfo();
    const inputSheet = doc.sheetsByTitle["input"];
    await inputSheet.loadHeaderRow();
    const inputRows = await inputSheet.getRows();
    const row = inputRows.find(
      (r) => String(r.searchId) === String(searchId) && r.runStatus === "Y"
    );
    if (!row) {
      return res.status(400).json({ error: "대기 중인 searchId가 아닙니다." });
    }

    const baseTrademark = row.baseTrademark || "";
    const query = row.searchQuery;

    // 2) searchQuery 파싱
    const parseQuery = (q) => {
      const parts = q.split("*");
      const map = {};
      parts.forEach((part) => {
        const [key, raw] = part.split("=");
        if (!key || !raw) return;
        map[key] = raw.replace(/\[|\]/g, "").split("+");
      });
      return {
        tnList: map["TN"] || [],
        tcList: map["TC"] || [],
        scList: map["SC"] || [],
      };
    };
    const { tnList, tcList, scList } = parseQuery(query);

    // 3) combos 생성
    const combos = [];
    for (const tn of tnList) {
      for (const tc of tcList) {
        for (const sc of scList) {
          combos.push({ tn, tc, sc });
        }
      }
    }

    // 4) 서울 현재시간
    const now = new Date();
    const seoulTime = now
      .toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })
      .replace(/\./g, "-")
      .replace(/년 |월 |일 /g, "")
      .trim();

    // 5) p-limit만으로 최대 50 동시 호출
    const limitCount = Math.min(combos.length, 50);
    const limit = pLimit(limitCount);
    const tasks = combos.map(({ tn, tc, sc }) =>
      limit(async () => {
        const params = {
          trademarkName: tn,
          classification: tc,
          similarityCode: sc,
          application: true,
          registration: true,
          refused: true,
          expiration: true,
          withdrawal: true,
          publication: true,
          cancel: true,
          abandonment: true,
          trademark: true,
          serviceMark: true,
          trademarkServiceMark: true,
          businessEmblem: true,
          collectiveMark: true,
          geoOrgMark: true,
          internationalMark: true,
          certMark: true,
          geoCertMark: true,
          character: true,
          figure: true,
          compositionCharacter: true,
          figureComposition: true,
          sound: true,
          fragrance: true,
          color: true,
          colorMixed: true,
          dimension: true,
          hologram: true,
          motion: true,
          visual: true,
          invisible: true,
          pageNo: 1,
          numOfRows: 500,
          sortSpec: "applicationDate",
          descSort: true,
          ServiceKey: process.env.KIPRIS_API_KEY,
          _type: "json"
        };
        try {
          const { data } = await axios.get(
            "http://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService/getAdvancedSearch",
            { params, timeout: 15000 }
          );
          const items = data?.response?.body?.items?.item;
          if (Array.isArray(items)) return items;
          if (items) return [items];
          return [];
        } catch (e) {
          console.warn(`KIPRIS 실패 (${tn},${tc},${sc}):`, e.message);
          return [];
        }
      })
    );
    const resultsArrays = await Promise.all(tasks);
    const allItems = resultsArrays.flat();

    // 6) 중복 제거
    const uniqueMap = new Map();
    allItems.forEach((item) => {
      if (item.applicationNumber) uniqueMap.set(item.applicationNumber, item);
    });
    const uniqueItems = Array.from(uniqueMap.values());

    // 7) input 시트 상태 업데이트
    row.processedAt = seoulTime;
    row.runStatus = "N";
    await row.save();

    // 8) result 시트 저장
    const resultSheet = doc.sheetsByTitle["result"];
    await resultSheet.loadHeaderRow();
    const appendRows = uniqueItems.map((item, i) => ({
      searchId,
      indexNo: i + 1,
      baseTrademark,
      applicationNumber: item.applicationNumber || "",
      applicationDate: item.applicationDate || "",
      publicationNumber: item.publicationNumber || "",
      publicationDate: item.publicationDate || "",
      registrationPublicNumber: item.registrationPublicNumber || "",
      registrationPublicDate: item.registrationPublicDate || "",
      registrationNumber: item.registrationNumber || "",
      registrationDate: item.registrationDate || "",
      priorityNumber: item.priorityNumber || "",
      priorityDate: item.priorityDate || "",
      applicationStatus: item.applicationStatus || "",
      classificationCode: item.classificationCode || "",
      viennaCode: item.viennaCode || "",
      applicantName: item.applicantName || "",
      agentName: item.agentName || "",
      title: item.title || "",
      fullText: item.fullText || "",
      drawing: item.drawing || "",
      bigDrawing: item.bigDrawing || "",
      appReferenceNumber: item.appReferenceNumber || "",
      regReferenceNumber: item.regReferenceNumber || "",
      internationalRegisterNumber: item.internationalRegisterNumber || "",
      internationalRegisterDate: item.internationalRegisterDate || "",
      processedAt: seoulTime,
      evaluation: ""
    }));
    await resultSheet.addRows(appendRows);

    return res.status(200).json({ searchId, results: uniqueItems });
  } catch (err) {
    console.error("[ERROR] api/search.js:", err);
    return res.status(500).json({ error: "서버 오류 발생", detail: err.message });
  }
}
