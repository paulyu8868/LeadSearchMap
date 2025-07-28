public with sharing class LeadSearchMapController {
    
    @AuraEnabled
    public static LodgingSearchResult searchLodgings(String sigunCode, String induType, Integer pageIndex) {
        try {
            System.debug('=== searchLodgings 시작 ===');
            System.debug('sigunCode: ' + sigunCode);
            System.debug('induType: ' + induType);
            System.debug('pageIndex: ' + pageIndex);
            
            // API 키 확인
            String apiKey = getAPIKey();
            if (String.isBlank(apiKey) || apiKey == 'YOUR_ACTUAL_API_KEY_HERE') {
                throw new AuraHandledException('API 키가 설정되지 않았습니다. LeadSearchMapController의 getAPIKey() 메서드에서 실제 API 키를 설정해주세요.');
            }
            
            // API 호출
            HttpRequest req = new HttpRequest();
            
            // URL 파라미터 소문자로 변경
            String endpoint = 'https://openapi.gg.go.kr/LodgingPension';
            endpoint += '?key=' + apiKey;  // key를 소문자로
            endpoint += '&type=json';      // type도 소문자로
            endpoint += '&pindex=' + pageIndex;  // pindex도 소문자로
            endpoint += '&psize=100';      // psize도 소문자로
            
            if (String.isNotBlank(sigunCode)) {
                endpoint += '&sigun_cd=' + sigunCode;  // sigun_cd도 소문자로
            }
            
            System.debug('API Endpoint: ' + endpoint);
            
            req.setEndpoint(endpoint);
            req.setMethod('GET');
            req.setTimeout(30000);
            
            Http http = new Http();
            HttpResponse res = http.send(req);
            
            System.debug('Response Status Code: ' + res.getStatusCode());
            System.debug('Response Body: ' + res.getBody());
            
            if (res.getStatusCode() == 200) {
                return parseLodgingData(res.getBody(), induType);
            } else {
                throw new AuraHandledException('API 호출 실패: ' + res.getStatusCode() + ' - ' + res.getBody());
            }
            
        } catch (Exception e) {
            System.debug('Exception Type: ' + e.getTypeName());
            System.debug('Exception Message: ' + e.getMessage());
            System.debug('Stack Trace: ' + e.getStackTraceString());
            throw new AuraHandledException('숙박업소 검색 중 오류 발생: ' + e.getMessage());
        }
    }
    
    private static LodgingSearchResult parseLodgingData(String jsonResponse, String induType) {
        LodgingSearchResult result = new LodgingSearchResult();
        result.lodgings = new List<LodgingData>();
        result.totalCount = 0;
        
        try {
            Map<String, Object> responseMap = (Map<String, Object>) JSON.deserializeUntyped(jsonResponse);
            
            // 첫 번째 키 가져오기 (LodgingPension)
            String rootKey = '';
            for (String key : responseMap.keySet()) {
                rootKey = key;
                break;
            }
            
            // API 응답이 List<Object>일 수 있음
            Object rootData = responseMap.get(rootKey);
            if (rootData == null) {
                System.debug('Root data is null');
                return result;
            }
            
            List<Object> rootList = new List<Object>();
            
            if (rootData instanceof List<Object>) {
                rootList = (List<Object>) rootData;
            } else {
                System.debug('Unexpected root data type: ' + rootData);
                return result;
            }
            
            if (rootList.isEmpty()) {
                System.debug('Root list is empty');
                return result;
            }
            
            Map<String, Object> dataMap = (Map<String, Object>) rootList[0];
            
            // 헤더 정보
            Object headObj = dataMap.get('head');
            if (headObj != null && headObj instanceof List<Object>) {
                List<Object> headList = (List<Object>) headObj;
                
                if (!headList.isEmpty()) {
                    Map<String, Object> headInfo = (Map<String, Object>) headList[0];
                    Object totalCountObj = headInfo.get('list_total_count');
                    if (totalCountObj != null) {
                        result.totalCount = Integer.valueOf(String.valueOf(totalCountObj));
                    }
                    
                    if (headList.size() > 1) {
                        Map<String, Object> resultInfo = (Map<String, Object>) headList[1];
                        Map<String, Object> resultData = (Map<String, Object>) resultInfo.get('RESULT');
                        if (resultData != null) {
                            String code = (String) resultData.get('CODE');
                            String message = (String) resultData.get('MESSAGE');
                            System.debug('API Result Code: ' + code);
                            System.debug('API Result Message: ' + message);
                            
                            if (code == 'INFO-200') {
                                // 데이터가 없는 경우
                                System.debug('No data found for the query');
                                return result;
                            } else if (code != 'INFO-000') {
                                throw new AuraHandledException('API 오류: ' + message);
                            }
                        }
                    }
                }
            }
            
            // 바디 정보
            Object rowObj = dataMap.get('row');
            if (rowObj == null) {
                System.debug('No row data found');
                return result;
            }
            
            List<Object> rows = new List<Object>();
            if (rowObj instanceof List<Object>) {
                rows = (List<Object>) rowObj;
            } else {
                System.debug('Unexpected row data type');
                return result;
            }
            
            System.debug('Found ' + rows.size() + ' rows');
            
            for (Object rowItem : rows) {
                try {
                    Map<String, Object> row = (Map<String, Object>) rowItem;
                    String bizInduType = (String) row.get('INDUTYPE_NM');
                    
                    // 업종 필터링
                    if (String.isNotBlank(induType) && induType != '전체') {
                        if (bizInduType == null || !bizInduType.contains(induType)) {
                            continue;
                        }
                    }
                    
                    LodgingData lodging = new LodgingData();
                    lodging.bizName = (String) row.get('BIZESTBL_NM');
                    lodging.induType = bizInduType;
                    lodging.roadAddr = (String) row.get('REFINE_ROADNM_ADDR');
                    lodging.lotnoAddr = (String) row.get('REFINE_LOTNO_ADDR');
                    lodging.telNo = (String) row.get('BIZESTBL_TELNO');
                    lodging.roomCnt = row.get('ROOM_CNT') != null ? String.valueOf(row.get('ROOM_CNT')) : '0';
                    lodging.repName = (String) row.get('REPRSNTV_NM');
                    lodging.subfaclt = (String) row.get('SUBFACLT_INFO');
                    lodging.parkYn = (String) row.get('PARKPLC_HOLD_YN');
                    lodging.homepage = (String) row.get('HMPG_ADDR');
                    lodging.tourismInfo = (String) row.get('CIRCUMFR_TURSM_INFO');
                    
                    // 위도/경도 처리
                    Object latObj = row.get('REFINE_WGS84_LAT');
                    Object lngObj = row.get('REFINE_WGS84_LOGT');
                    
                    if (latObj != null && lngObj != null) {
                        try {
                            lodging.lat = Double.valueOf(String.valueOf(latObj));
                            lodging.lng = Double.valueOf(String.valueOf(lngObj));
                        } catch (Exception e) {
                            System.debug('Error parsing coordinates: ' + e.getMessage());
                            continue;
                        }
                    }
                    
                    lodging.sigunNm = (String) row.get('SIGUN_NM');
                    
                    if (lodging.lat != null && lodging.lng != null && lodging.bizName != null) {
                        result.lodgings.add(lodging);
                    }
                } catch (Exception e) {
                    System.debug('Error parsing row: ' + e.getMessage());
                    continue;
                }
            }
            
            System.debug('Successfully parsed ' + result.lodgings.size() + ' lodgings');
            
        } catch (Exception e) {
            System.debug('파싱 에러: ' + e.getMessage());
            System.debug('스택 트레이스: ' + e.getStackTraceString());
            throw new AuraHandledException('데이터 파싱 중 오류 발생: ' + e.getMessage());
        }
        
        return result;
    }
    
    @AuraEnabled
    public static String convertToLead(LodgingData lodging) {
        try {
            // 중복 체크
            List<Lead> existingLeads = [
                SELECT Id, Company, Phone
                FROM Lead 
                WHERE Company = :lodging.bizName 
                OR (Phone != null AND Phone = :lodging.telNo)
                LIMIT 1
            ];
            
            Lead newLead;
            if (!existingLeads.isEmpty()) {
                // 기존 리드 업데이트
                newLead = existingLeads[0];
            } else {
                // 신규 리드 생성
                newLead = new Lead();
            }
            
            // 필드 매핑
            newLead.Company = lodging.bizName;
            newLead.LastName = lodging.bizName; // Required field
            newLead.Status = '연락 O'; // Required field
            newLead.Phone = lodging.telNo;
            newLead.BillingStreet__c = lodging.roadAddr;
            newLead.BillingCity__c = lodging.sigunNm;
            newLead.BillingState__c = '경기도';
            newLead.Room__c = String.isNotBlank(lodging.roomCnt) ? Integer.valueOf(lodging.roomCnt) : null;
            newLead.sf_product__c = '스탠다드 호텔';
            newLead.LeadSource = 'Web';
            
            // Description 필드 구성
            String description = '';
            if (String.isNotBlank(lodging.repName)) {
                description += '대표자: ' + lodging.repName + '\n';
            }
            if (String.isNotBlank(lodging.subfaclt)) {
                description += '부대시설: ' + lodging.subfaclt + '\n';
            }
            if (String.isNotBlank(lodging.tourismInfo)) {
                description += '주변관광정보: ' + lodging.tourismInfo + '\n';
            }
            if (String.isNotBlank(lodging.parkYn)) {
                description += '주차장: ' + lodging.parkYn;
            }
            newLead.Description = description;
            
            if (String.isNotBlank(lodging.homepage)) {
                newLead.Website = lodging.homepage;
            }
            
            upsert newLead;
            
            return newLead.Id;
            
        } catch (Exception e) {
            throw new AuraHandledException('리드 생성 중 오류 발생: ' + e.getMessage());
        }
    }
    
    private static String getAPIKey() {
        // 여기에 실제 경기데이터드림에서 발급받은 API 키를 입력하세요
        // 예시: return 'abcd1234efgh5678ijkl9012mnop3456';
        return 'b9f5cb604d774082a8f974bfe985337b';
    }
    
    // Inner Classes
    public class LodgingSearchResult {
        @AuraEnabled public List<LodgingData> lodgings { get; set; }
        @AuraEnabled public Integer totalCount { get; set; }
    }
    
    public class LodgingData {
        @AuraEnabled public String bizName { get; set; }
        @AuraEnabled public String induType { get; set; }
        @AuraEnabled public String roadAddr { get; set; }
        @AuraEnabled public String lotnoAddr { get; set; }
        @AuraEnabled public String telNo { get; set; }
        @AuraEnabled public String roomCnt { get; set; }
        @AuraEnabled public String repName { get; set; }
        @AuraEnabled public String subfaclt { get; set; }
        @AuraEnabled public String parkYn { get; set; }
        @AuraEnabled public String homepage { get; set; }
        @AuraEnabled public String tourismInfo { get; set; }
        @AuraEnabled public Double lat { get; set; }
        @AuraEnabled public Double lng { get; set; }
        @AuraEnabled public String sigunNm { get; set; }
    }
}