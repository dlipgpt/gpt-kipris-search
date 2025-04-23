import { GoogleSpreadsheet } from 'google-spreadsheet';

// 구글 시트에서 데이터 불러오는 함수
async function getSheetData() {
  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

  // 서비스 계정 인증
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });

  // 구글 시트 문서 불러오기
  await doc.loadInfo();

  // 'result' 시트 선택
  const sheet = doc.sheetsByTitle['result'];

  // 시트에서 모든 데이터 가져오기
  const rows = await sheet.getRows();

  return rows;  // 불러온 데이터 반환
}

export default getSheetData;
