// api/search.js

import { GoogleSpreadsheet } from "google-spreadsheet";
import axios from "axios";

export default async function handler(req, res) {
  try {
    // 1) 요청 파라미터
    const searchId = req.query.searchId;
    if (!searchId) {
      return res.status(400).json({ error: "searchId가 필요합니다." });
    }

    // 2) 구글시트 로드
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_SPREADSHEET_ID);
    await doc.useServiceAccountAuth(
      JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS)
    );
    await doc.loadInfo();

    // 3) input 시트에서 해당 row 찾기
    const inputSheet = doc.sheetsByTitle["input"];
    await inputSheet.loadHeaderRow();
    const rows = await inputSheet.getRows();
    const row = rows.find(r => String(r.searchId) === String(searchId) && r.runStatus === "Y");
    if (!row) {
      return res.status(400).json({ error: "대기 중인 searchId가 아닙니다." });
    }

    // 4) processedAt (한국시간) 기록, runStatus → "N"으로 변경
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

    // 5) 검색식 파싱 (TN, TC, SC 각각 분리)
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
    const { tnList, tcList, scList } = parseQuery(row.searchQuery);

    // 6) 모든 조합으로 KIPRIS 호출
    const combos = [];
    for (const tn of tnList)
      for (const tc of tcList)
        for (const sc of scList)
          combos.push({ tn, tc, sc });

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
        ServiceKey: process.env.KIPRIS_KEY,
        _type: "json"
      };
      const { data } = await axios.get(
        "http://plus.kipris.or.kr/kipo-api/kipi/trademarkInfoSearchService/getAdvancedSearch",
        { params, timeout: 15000 }
      );
      const items = data?.response?.body?.items?.item;
      if (Array.isArray(items)) {
        allItems = allItems.concat(items);
      }
    }

    // 7) applicationNumber 기준 중복 제거
    const seen = new Set();
    const uniqueItems = allItems.filter(item => {
      if (seen.has(item.applicationNumber)) return false;
      seen.add(item.applicationNumber);
      return true;
    });

    // 8) result 시트에 append
    const resultSheet = doc.sheetsByTitle["result"];
    await resultSheet.loadHeaderRow();
    const appendRows = uniqueItems.map(item => ({
      searchId: searchId,
      applicationNumber: item.applicationNumber,
      classificationCode: item.classificationCode,
      title: item.title,
      applicantName: item.applicantName,
      applicationDate: item.applicationDate,
      registrationNumber: item.registrationNumber || "",
      fullText: item.fullText,
      drawing: item.drawing,
      bigDrawing: item.bigDrawing
    }));
    await resultSheet.addRows(appendRows);

    // 9) 최종 응답
    return res.json({
      searchId,
      results: uniqueItems
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "서버 오류 발생", detail: err.message });
  }
}
