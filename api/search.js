import { GoogleSpreadsheet } from "google-spreadsheet";
import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET requests allowed" });
  }

  try {
    const searchId = req.query.searchId;
    if (!searchId) {
      return res.status(400).json({ error: "searchId가 필요합니다." });
    }

    // Google Sheets 인증 및 input 로드
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
      return res
        .status(400)
        .json({ error: "대기 중인 searchId가 아닙니다." });
    }

    const baseTrademark = row.baseTrademark || "";
    const query = row.searchQuery;

    // debug 로그
    console.log("[DEBUG] raw searchQuery:", query);
    const parseQuery = (q) => {
      const parts = q.split("*");
      const map = {};
      parts.forEach((part) => {
        const [key, raw] = part.split("=");
        if (!key || !raw) return;
        map[key] = raw.replace(/[\[\]]/g, "").split("+");
      });
      return {
        tnList: map["TN"] || [],
        tcList: map["TC"] || [],
        scList: map["SC"] || [],
      };
    };
    const { tnList, tcList, scList } = parseQuery(query);
    console.log("[DEBUG] tnList:", tnList);
    console.log("[DEBUG] tcList:", tcList);
    console.log("[DEBUG] scList:", scList);

    const combos = [];
    for (const tn of tnList) {
      for (const tc of tcList) {
        for (const sc of scList) {
          combos.push({ tn, tc, sc });
        }
      }
    }
    console.log("[DEBUG] combos:", combos);

    // 시간 계산
    const now = new Date();
    const seoulTime = now
      .toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })
      .replace(/\./g, "-")
      .replace(/년 |월 |일 /g, "")
      .trim();

    // KIPRIS 호출
    let allItems = [];
    for (const { tn, tc, sc } of combos) {
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
        _type: "json",
      };

      try {
        const { data } = await axios.get(
          "http://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService/getAdvancedSearch",
          { params, timeout: 15000 }
        );
        const items = data?.response?.body?.items?.item;
        if (Array.isArray(items)) {
          allItems = allItems.concat(items);
        } else if (items) {
          // 단일 객체인 경우도 추가
          allItems.push(items);
        } else {
          console.log("KIPRIS API에서 아이템을 찾을 수 없음 (no item)");
        }
      } catch (err) {
        console.warn(
          `[WARN] KIPRIS 호출 실패 (TN=${tn},TC=${tc},SC=${sc}): ${err.message}`
        );
      }
    }

    // 중복 제거
    const uniqueMap = new Map();
    for (const item of allItems) {
      if (item.applicationNumber) {
        uniqueMap.set(item.applicationNumber, item);
      }
    }
    const uniqueItems = Array.from(uniqueMap.values());

    // input 상태 업데이트
    row.processedAt = seoulTime;
    row.runStatus = "N";
    await row.save();

    // result 시트에 저장
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
      evaluation: "",
    }));
    await resultSheet.addRows(appendRows);

    return res.status(200).json({ searchId, results: uniqueItems });
  } catch (err) {
    console.error("[ERROR] api/search.js:", err);
    return res
      .status(500)
      .json({ error: "서버 오류 발생", detail: err.message });
  }
}
