
1. index.png와 같은 모습의 화면에서 에서 로그인을 하면 main-screen.png 화면의 페이지로 이동
2. main-screen.html에서 [강좌 만들기] 버튼을 누르면 create-lecture() 함수를 호출
    2-1. create_lecture() 함수
        2-1-1. 강좌명, 강좌 설명을 입력 받고 개설 강좌 목록에 추가
        2-1-2. lecture.html과 같은 구조의 html 문서를 생성함
        2-1-3. [이동] 버튼을 눌렀을 때, 생성한 html 문서로 이동
3. lecture.html 생성 방법
    3-1. class page-title의 innerHtml은 강좌명으로 설정
    3-2. [과제 생성] 버튼을 누르면 create-assignment() 함수 호출
    3-3. create-assignment() 함수
        3-3-1. 과제 제목, 과제 설명, 평가루브릭, 마감일 설정
        3-3-2. 평가루브릭: 평가 항목과 배점으로 구성됨. 여러개 추가 가능함. 총점 제시
    3-4. [제출] 버튼을 누르면 파일 업로드 함
    3-5. [확인] 버튼을 누르면 제출한 과제 평가 결과를 확인함: evaluation-results.html 파일로 이동
    3-6. [평가] 버튼을 누르면 교수가 과제 평가를 수행함: evaluation.html 파일로 이동
