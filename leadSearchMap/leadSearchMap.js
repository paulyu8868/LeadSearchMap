import { LightningElement, track } from 'lwc';
import { loadStyle, loadScript } from 'lightning/platformResourceLoader';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import LEAFLET_CSS from '@salesforce/resourceUrl/leafletCSS';
import LEAFLET_JS from '@salesforce/resourceUrl/leafletJS';
import searchLodgings from '@salesforce/apex/LeadSearchMapController.searchLodgings';
import convertToLead from '@salesforce/apex/LeadSearchMapController.convertToLead';

export default class LeadSearchMap extends NavigationMixin(LightningElement) {
    @track isLoading = false;
    @track errorMessage = '';
    @track isMapInitialized = false;
    @track lodgings = [];
    @track displayedLodgings = [];
    @track selectedSigun = '';
    @track selectedInduType = '';
    @track sigunOptions = [{ label: '시/군 선택', value: '' }];
    @track totalCount = 0;
    @track currentPage = 1;
    @track isLoadingMore = false;
    
    map;
    lodgingMarkers = null;
    markerMap = new Map(); // lodging ID to marker mapping
    
    // 경기도 시군 데이터 (실제 데이터가 있는 시군만)
    sigunData = [
        { label: '가평군', value: '41820' },
        { label: '고양시', value: '41280' },
        { label: '광주시', value: '41610' },
        { label: '남양주시', value: '41360' },
        { label: '동두천시', value: '41250' },
        { label: '수원시', value: '41110' },
        { label: '안산시', value: '41270' },
        { label: '안성시', value: '41550' },
        { label: '양주시', value: '41630' },
        { label: '양평군', value: '41830' },
        { label: '연천군', value: '41800' },
        { label: '이천시', value: '41500' },
        { label: '파주시', value: '41480' },
        { label: '포천시', value: '41650' }
    ];
    
    // 업종 옵션
    induTypeOptions = [
        { label: '전체', value: '전체' },
        { label: '민박', value: '민박' },
        { label: '펜션', value: '펜션' }
    ];
    
    // 기본 중심점 (경기도청)
    defaultCenter = {
        lat: 37.2750,
        lng: 127.0095
    };
    
    // 가상 스크롤 관련
    itemsPerPage = 20;
    currentDisplayCount = 20;
    
    async connectedCallback() {
        this.initializeSigunOptions();
        await this.loadLeafletResources();
    }
    
    initializeSigunOptions() {
        this.sigunOptions = [
            { label: '시/군 선택', value: '' },
            ...this.sigunData
        ];
        console.log('시군 옵션 초기화 완료:', this.sigunOptions.length);
    }
    
    async loadLeafletResources() {
        try {
            await Promise.all([
                loadStyle(this, LEAFLET_CSS),
                loadScript(this, LEAFLET_JS)
            ]);
            
            console.log('Leaflet 리소스 로딩 완료');
            this.initializeMap();
        } catch (error) {
            console.error('Leaflet 리소스 로딩 실패:', error);
            this.errorMessage = 'Leaflet 라이브러리를 불러올 수 없습니다.';
        }
    }
    
    initializeMap() {
        try {
            const mapContainer = this.template.querySelector('.map-div');
            
            if (!mapContainer) {
                console.error('지도 컨테이너를 찾을 수 없습니다');
                return;
            }
            
            // Leaflet 지도 생성
            this.map = window.L.map(mapContainer).setView([this.defaultCenter.lat, this.defaultCenter.lng], 10);
            
            // OpenStreetMap 타일 레이어 추가
            window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(this.map);
            
            // 마커 레이어 그룹 초기화
            this.lodgingMarkers = window.L.layerGroup();
            this.lodgingMarkers.addTo(this.map);
            
            this.isMapInitialized = true;
            console.log('지도 초기화 완료');
            
        } catch (error) {
            console.error('지도 초기화 실패:', error);
            this.errorMessage = '지도를 초기화할 수 없습니다.';
        }
    }
    
    // 시군 선택
    handleSigunChange(event) {
        this.selectedSigun = event.detail.value;
    }
    
    // 업종 선택
    handleInduTypeChange(event) {
        this.selectedInduType = event.detail.value;
    }
    
    // 검색 버튼 클릭
    async handleSearch() {
        if (!this.selectedSigun) {
            this.showToast('알림', '시/군을 선택해주세요.', 'warning');
            return;
        }
        
        this.isLoading = true;
        this.clearLodgings();
        this.currentPage = 1;
        
        try {
            await this.fetchLodgings();
        } catch (error) {
            console.error('검색 실패:', error);
            let errorMessage = '숙박업소 데이터를 불러올 수 없습니다.';
            
            // 더 자세한 에러 메시지 추출
            if (error.body && error.body.message) {
                errorMessage = error.body.message;
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            this.showToast('오류', errorMessage, 'error');
        } finally {
            this.isLoading = false;
        }
    }
    
    // 숙박업소 데이터 가져오기
    async fetchLodgings() {
        try {
            console.log('API 호출 시작...');
            console.log('sigunCode:', this.selectedSigun);
            console.log('induType:', this.selectedInduType);
            console.log('pageIndex:', this.currentPage);
            
            const result = await searchLodgings({
                sigunCode: this.selectedSigun,
                induType: this.selectedInduType || '전체',
                pageIndex: this.currentPage
            });
            
            console.log('API 응답:', result);
            console.log('lodgings 배열:', result?.lodgings);
            console.log('lodgings 길이:', result?.lodgings?.length);
            
            if (result && result.lodgings && result.lodgings.length > 0) {
                this.totalCount = result.totalCount || result.lodgings.length;
                // 데이터 가공 - isPension 플래그와 iconClass 추가
                this.lodgings = result.lodgings.map(lodging => ({
                    ...lodging,
                    isPension: lodging.induType && lodging.induType.includes('펜션'),
                    iconClass: lodging.induType && lodging.induType.includes('펜션') ? 
                        'indutype-icon pension-icon' : 'indutype-icon minbak-icon'
                }));
                
                console.log('가공된 lodgings:', this.lodgings);
                
                this.displayedLodgings = this.lodgings.slice(0, this.itemsPerPage);
                this.currentDisplayCount = this.itemsPerPage;
                
                console.log('displayedLodgings:', this.displayedLodgings);
                
                // 지도에 마커 추가
                this.addLodgingMarkers();
                
                // 첫 번째 숙박업소 위치로 이동
                if (this.lodgings.length > 0 && this.lodgings[0].lat && this.lodgings[0].lng) {
                    console.log('지도 이동:', this.lodgings[0].lat, this.lodgings[0].lng);
                    this.map.setView([this.lodgings[0].lat, this.lodgings[0].lng], 13);
                }
                
                this.showToast('성공', `${this.lodgings.length}개의 숙박업소를 찾았습니다.`, 'success');
            } else {
                console.log('검색 결과가 없습니다');
                this.lodgings = [];
                this.displayedLodgings = [];
                this.totalCount = 0;
                this.clearLodgings();
                
                if (result && result.lodgings && result.lodgings.length === 0) {
                    this.showToast('알림', '검색 결과가 없습니다.', 'info');
                } else {
                    this.showToast('오류', '데이터를 불러올 수 없습니다.', 'error');
                }
            }
        } catch (error) {
            console.error('API 호출 실패:', error);
            console.error('Error body:', error.body);
            console.error('Error message:', error.body?.message);
            console.error('Error stack:', error.body?.stackTrace);
            throw error;
        }
    }
    
    // 마커 추가
    addLodgingMarkers() {
        console.log('=== addLodgingMarkers 시작 ===');
        console.log('lodgings 개수:', this.lodgings.length);
        console.log('map 객체:', this.map);
        console.log('lodgingMarkers 레이어:', this.lodgingMarkers);
        
        // 기존 마커 제거
        this.lodgingMarkers.clearLayers();
        this.markerMap.clear();
        
        this.lodgings.forEach((lodging, index) => {
            console.log(`마커 ${index} 생성 중:`, lodging.bizName, lodging.lat, lodging.lng);
            const marker = this.createLodgingMarker(lodging, index);
            this.lodgingMarkers.addLayer(marker);
            this.markerMap.set(index, marker);
        });
        
        console.log('마커 추가 완료. 총 마커 수:', this.markerMap.size);
    }
    
    // 숙박업소 마커 생성
    createLodgingMarker(lodging, index) {
        // 업종별 아이콘 결정
        const icon = lodging.induType.includes('펜션') ? '🏡' : '🏠';
        const markerColor = lodging.induType.includes('펜션') ? '#10B981' : '#3B82F6';
        
        const divIcon = window.L.divIcon({
            html: `
                <div class="marker lodging" style="background-color: ${markerColor};">
                    <div class="marker-icon">${icon}</div>
                    <div class="room-count">${lodging.roomCnt}</div>
                </div>
            `,
            className: 'custom-marker-container',
            iconSize: [50, 50],
            iconAnchor: [25, 25]
        });
        
        const popupContent = this.createPopupContent(lodging, index);
        const marker = window.L.marker([lodging.lat, lodging.lng], { icon: divIcon })
            .bindPopup(popupContent, { autoPan: false, maxWidth: 300 });
        
        marker.on('click', (e) => {
            this.map.setView(e.latlng, this.map.getZoom());
            setTimeout(() => {
                marker.openPopup();
                this.attachPopupEventHandlers(lodging, index);
            }, 300);
        });
        
        return marker;
    }
    
    // 팝업 내용 생성
    createPopupContent(lodging, index) {
        const hasHomepage = lodging.homepage && lodging.homepage.trim() !== '';
        
        return `
            <div class="popup-content" style="min-width: 250px;">
                <div style="margin-bottom: 8px;">
                    <strong style="color: #080707; font-size: 14px;">${lodging.bizName}</strong>
                </div>
                <div style="font-size: 13px; color: #706E6B; margin-bottom: 12px;">
                    <div><strong>업종:</strong> ${lodging.induType}</div>
                    <div><strong>주소:</strong> ${lodging.roadAddr || lodging.lotnoAddr}</div>
                    ${lodging.telNo ? `<div><strong>전화:</strong> ${lodging.telNo}</div>` : ''}
                    <div><strong>객실수:</strong> ${lodging.roomCnt}개</div>
                    ${lodging.repName ? `<div><strong>대표자:</strong> ${lodging.repName}</div>` : ''}
                    ${lodging.subfaclt ? `<div><strong>부대시설:</strong> ${lodging.subfaclt}</div>` : ''}
                    ${lodging.parkYn ? `<div><strong>주차장:</strong> ${lodging.parkYn}</div>` : ''}
                    ${lodging.tourismInfo ? `<div style="margin-top: 8px;"><strong>주변관광정보:</strong><br>${lodging.tourismInfo}</div>` : ''}
                </div>
                <div class="popup-buttons" style="display: flex; gap: 8px; margin-top: 12px;">
                    ${hasHomepage ? 
                        `<button data-homepage="${lodging.homepage}" class="popup-btn homepage-btn" style="flex: 1; background: #1B96FF; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer;">
                            홈페이지
                        </button>` : ''
                    }
                    <button data-index="${index}" class="popup-btn lead-btn" style="flex: 1; background: #04844B; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer;">
                        리드 생성
                    </button>
                </div>
            </div>
        `;
    }
    
    // 팝업 이벤트 핸들러 연결
    attachPopupEventHandlers(lodging, index) {
        // 홈페이지 버튼
        const homepageBtn = document.querySelector('.homepage-btn');
        if (homepageBtn) {
            homepageBtn.onclick = () => {
                const url = homepageBtn.getAttribute('data-homepage');
                window.open(url.startsWith('http') ? url : 'http://' + url, '_blank');
            };
        }
        
        // 리드 생성 버튼
        const leadBtn = document.querySelector('.lead-btn');
        if (leadBtn) {
            leadBtn.onclick = () => {
                this.convertToLeadAction(lodging);
            };
        }
    }
    
    // 리드 전환 (리스트에서)
    handleConvertToLead(event) {
        const index = parseInt(event.currentTarget.dataset.index);
        const lodging = this.lodgings[index];
        if (lodging) {
            this.convertToLeadAction(lodging);
        }
    }
    
    // 리드 전환 실제 처리
    async convertToLeadAction(lodging) {
        try {
            this.isLoading = true;
            const leadId = await convertToLead({ lodging: lodging });
            
            this.showToast('성공', '리드가 생성되었습니다.', 'success');
            
            // 생성된 리드 페이지로 이동
            this[NavigationMixin.Navigate]({
                type: 'standard__recordPage',
                attributes: {
                    recordId: leadId,
                    objectApiName: 'Lead',
                    actionName: 'view'
                }
            });
        } catch (error) {
            console.error('리드 생성 실패:', error);
            this.showToast('오류', '리드 생성 중 오류가 발생했습니다.', 'error');
        } finally {
            this.isLoading = false;
        }
    }
    
    // 위치 보기 버튼 클릭
    handleViewLocation(event) {
        const index = parseInt(event.currentTarget.dataset.index);
        const lodging = this.lodgings[index];
        const marker = this.markerMap.get(index);
        
        if (lodging && marker) {
            this.map.setView([lodging.lat, lodging.lng], 16);
            setTimeout(() => {
                marker.openPopup();
                this.attachPopupEventHandlers(lodging, index);
            }, 500);
        }
    }
    
    // 스크롤 처리
    handleScroll(event) {
        const element = event.target;
        const threshold = 100;
        
        if (element.scrollHeight - element.scrollTop <= element.clientHeight + threshold) {
            this.loadMoreItems();
        }
    }
    
    // 추가 아이템 로드
    loadMoreItems() {
        if (this.currentDisplayCount < this.lodgings.length && !this.isLoadingMore) {
            this.isLoadingMore = true;
            
            setTimeout(() => {
                const nextCount = Math.min(
                    this.currentDisplayCount + this.itemsPerPage,
                    this.lodgings.length
                );
                // displayedLodgings도 가공된 데이터 유지
                this.displayedLodgings = this.lodgings.slice(0, nextCount);
                this.currentDisplayCount = nextCount;
                this.isLoadingMore = false;
            }, 300);
        }
    }
    
    // 숙박업소 초기화
    clearLodgings() {
        this.lodgingMarkers.clearLayers();
        this.lodgings = [];
        this.displayedLodgings = [];
        this.markerMap.clear();
        this.totalCount = 0;
    }
    
    // 홈 버튼 클릭
    goToHome() {
        if (this.map) {
            this.map.setView([this.defaultCenter.lat, this.defaultCenter.lng], 10);
        }
    }
    
    // Toast 메시지 표시
    showToast(title, message, variant) {
        const event = new ShowToastEvent({
            title: title,
            message: message,
            variant: variant
        });
        this.dispatchEvent(event);
    }
    
    // 검색 버튼 비활성화 여부
    get isSearchDisabled() {
        return !this.selectedSigun || this.isLoading;
    }
    
    // 결과 없음 표시 여부
    get hasNoResults() {
        return !this.isLoading && this.lodgings.length === 0;
    }
}