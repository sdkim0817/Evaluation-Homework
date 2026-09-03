Listed directory antigravity_ver
Viewed package.json:1-24
Viewed test_gemini.js:1-51
Viewed server.js:1-800

이 프로젝트의 실행 및 테스트는 크게 **웹 서버 실행**과 **API 연동 단독 테스트** 두 가지 방법으로 나누어 진행할 수 있습니다. 

상황에 맞게 아래의 방법을 참고하여 실행해 보시기 바랍니다.

---

### 1. 로컬 웹 서버 실행 및 웹 UI 테스트

Express 기반의 웹 서버와 DB를 기동하여 프론트엔드 화면(`public/` 폴더) 및 전체 시나리오를 테스트하는 방법입니다.

1. **의존성 모듈 설치** (아직 설치하지 않은 경우)
   프로젝트 루트 디렉토리에서 아래 명령어로 패키지를 설치합니다.
   ```bash
   npm install
   ```

2. **환경 변수 파일 설정 (`.env`)**
   루트 디렉토리의 `.env` 파일에 API Key가 정상적으로 입력되어 있는지 확인합니다.
   * 예: `OPENAI_API_KEY=your_openai_key`
   * 또는 `GEMINI_API_KEY=your_gemini_key`

3. **서버 실행**
   개발 모드(코드 수정 시 자동 재시작)로 실행하려면 아래 명령어를 입력합니다.
   ```bash
   npm run dev
   ```
   일반 모드로 서버를 시작하려면 아래 명령어를 입력합니다.
   ```bash
   npm start
   ```

4. **웹 브라우저 접속**
   서버가 시작되면 기본적으로 `http://localhost:3000` 포트로 실행됩니다. 웹 브라우저를 열고 해당 주소로 접속하여 회원가입, 로그인, 과제 제출 등의 기능을 테스트할 수 있습니다.
   * **교수 계정 가입 ID**: `110528` (이 학번으로 가입 시 교수의 권한을 획득합니다.)
   * **학생 계정 가입 ID**: `110528` 이외의 다른 ID/학번

---

### 2. API 연동 단독 테스트 (스크립트 실행)

LLM API(Gemini 또는 OpenAI) 연동이 정상적으로 작동하는지 화면 없이 빠르게 터미널에서 검증해 보려면 준비된 테스트 스크립트를 실행합니다.

* **Gemini API 테스트**:
  ```bash
  node test_gemini.js
  ```
* **OpenAI API 테스트**:
  ```bash
  node test_openai.js
  ```

실행 후 터미널에 LLM이 생성한 응답 텍스트(예: "Hello, how are you?"에 대한 답변)가 출력되면 API 연동이 정상 상태인 것입니다.