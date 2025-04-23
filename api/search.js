import { GoogleSpreadsheet } from "google-spreadsheet";
import axios from "axios";

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
    const row = inputRows.find(r => String(r.searchId) === String(searchId) && r.runStatus === "Y");
    if (!row) {
      return res.status(400).json({ error: "대기 중인 searchId가 아닙니다." });
    }

    const baseTrademark = row.baseTrademark || "";
    const query = row.searchQuery;

    const now = new Date();
    const seoulTime = now.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      hour12: false
    })
      .replace(/\./g, "-")
      .replace(/년 |월 |일 /g, "")
      .trim();
    row.processedAt = seoulTime;
    row.runStatus = "N";
    await row.save();

    const parseQuery = (q) => {
      const extract = key => {
        const m = q.match(new RegExp(`${key}=\\[([^\\]]+)\\]`));
        return m ? m[1].split("+") : [];
      };
      return {
        tnList: extract("TN"),
        tcList: extract("TC"),
        scList: extract("SC"),
      };
    };
    const { tnList, tcList, scList } = parseQuery(query);
    console.log('TN List:', tnList);
    console.log('TC List:', tcList);
    console.log('SC List:', scList);

    const combos = [];
    for (const tn of tnList)
      for (const tc of tcList)
        for (const sc of scList)
          combos.push({ tn, tc, sc });

    console.log("조합 리스트:", combos);

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
        _type: "json"
      };

      const { data } = await axios.get(
        "http://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService/getAdvancedSearch",
        { params, timeout: 15000 }
      );

      const items = data?.response?.body?.items?.item;
      if (Array.isArray(items)) {
        allItems = allItems.concat(items);
      } else {
        console.log('KIPRIS API에서 아이템을 찾을 수 없음');
      }
    }

    // 중복 제거 (덮어쓰기 방식)
    const uniqueMap = new Map();
    for (const item of allItems) {
      if (!item.applicationNumber) continue;
      uniqueMap.set(item.applicationNumber, item);
    }
    const uniqueItems = Array.from(uniqueMap.values());

    const resultSheet = doc.sheetsByTitle["result"];
    await resultSheet.loadHeaderRow();

    const appendRows = uniqueItems.map((item, i) => ({
      searchId,
      indexNo: i + 1,
      baseTrademark, // ✅ baseTrademark 추가
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

    console.log('최종 저장 행 수:', appendRows.length);
    await resultSheet.addRows(appendRows);

    return res.json({
      searchId,
      results: uniqueItems
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "서버 오류 발생", detail: err.message });
  }
}
