# AI 관여도(ai_involvement_score) 평가 및 DB 반영 계획

제출물(코드 및 콘텐츠)에서 AI의 도움을 받아 생성·수정된 비율을 0.0 ~ 1.0 범위의 `ai_involvement_score`로 평가하고, 이를 LLM 프롬프트 JSON 출력, DB 저장, API 및 UI(학생/교수 화면)에 반영하는 구현 계획입니다.

> [!NOTE]
> 현재 프로젝트에는 기본적인 `ai_involvement_score` 컬럼 및 프롬프트 연동 구조가 포함되어 있으나, 전체 파이프라인(DB 스키마, 프롬프트, API, 프론트엔드 UI)이 완전하게 작동하고 유지될 수 있도록 수정 및 점검 포인트를 정리하였습니다.

---

## User Review Required

> [!IMPORTANT]
> 1. **점수 표현 방식**: AI 관여도를 0.0 ~ 1.0 실수(예: `0.35`)로 저장하고 UI 표시 시 백분율(예: `35% (0.35)`)로 보여주는 구성이 적절한지 확인 부탁드립니다.
> 2. **기존 DB 마이그레이션**: 기존 `database.db` 파일이 존재하는 경우 `ALTER TABLE evaluations ADD COLUMN ai_involvement_score REAL DEFAULT 0.0;`을 실행하여 호환성을 보장합니다.

---

## Proposed Changes

### 백엔드 및 DB ([server.js](file:///d:/Project/eval-assignment/antigravity_ver/server.js))

#### [MODIFY] [server.js](file:///d:/Project/eval-assignment/antigravity_ver/server.js)

1. **DB 테이블 스키마 및 마이그레이션**:
   - `evaluations` 테이블 생성 쿼리에 `ai_involvement_score REAL DEFAULT 0.0` 추가.
   - 기존 DB 파일 호환을 위한 `ALTER TABLE` 구문 실행.
   ```sql
   CREATE TABLE IF NOT EXISTS evaluations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     submission_id INTEGER NOT NULL,
     score INTEGER NOT NULL,
     feedback TEXT NOT NULL,
     ai_involvement_score REAL DEFAULT 0.0,
     evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
   );
   ```

2. **LLM 평가 프롬프트 수정**:
   - LLM 평가 프롬프트 요구사항에 AI 관여 수준 측정 지침 추가:
     `4. 제출물(코드 또는 콘텐츠) 중 ChatGPT 등의 AI 도구의 도움을 받아 생성되거나 수정되었을 것으로 추정되는 AI 관여 수준(ai_involvement_score)을 0.0에서 1.0 사이의 실수로 측정해 주세요. (0.0=전혀 없음, 1.0=100% AI 생성/수정 추정)`
   - JSON 출력 스키마 정의:
     ```json
     {
       "score": [계산된 총점 (정수)],
       "feedback": "[루브릭 항목별 평가 내역과 종합 평가 피드백 (한국어)]",
       "ai_involvement_score": [0.0에서 1.0 사이의 AI 관여도 추정 실수값]
     }
     ```

3. **응답 파싱 및 DB 저장 처리**:
   - LLM 응답 JSON 파싱 시 `ai_involvement_score`를 추출하고 0.0 ~ 1.0 사이 값으로 클램핑(clamping) 및 소수점 둘째 자리 반올림 처리.
   - Mock 채점 함수(`generateMockEvaluation`)에도 `ai_involvement_score` 생성 로직 포함.
   - `INSERT INTO evaluations (submission_id, score, feedback, ai_involvement_score) VALUES (?, ?, ?, ?)` 파라미터 바인딩.

4. **API 조회 쿼리 반영**:
   - `/api/assignments/:assignmentId/submissions` (교수용 제출 목록)
   - `/api/submissions/:submissionId/evaluation` (학생/교수 평가 상세)
   - `/api/assignments/:assignmentId/my-submission` (학생 본인 제출)
   - 위 SQL 쿼리의 `SELECT` 절에 `e.ai_involvement_score` 포함 확인.

---

### 프론트엔드 UI

#### [MODIFY] [evaluation-results.html](file:///d:/Project/eval-assignment/antigravity_ver/public/evaluation-results.html)
- **학생용 평가 결과 페이지**:
  - 요약 카드에 `AI 관여도 추정` 항목 추가 (`<span id="aiScore">`).
  - API 수신 데이터의 `ai_involvement_score`를 퍼센트 및 실수 형식으로 바인딩 (예: `35% (0.35)`).

#### [MODIFY] [evaluation.html](file:///d:/Project/eval-assignment/antigravity_ver/public/evaluation.html)
- **교수용 평가 현황 페이지**:
  - 제출 목록 테이블 헤더에 `AI 관여도 추정` 컬럼 추가 (`<th>AI 관여도 추정</th>`).
  - 각 학생의 평가 행에 `35% (0.35)` 형식으로 시각화.
  - 상세 피드백 모달에도 AI 관여도 정보 표시 영역 포함 (`#feedbackModalAiScore`).

---

## Verification Plan

### Automated Tests
- Server 실행 (`node server.js`) 및 API 엔드포인트 응답 검증.

### Manual Verification
1. `node server.js` 구동 후 웹 브라우저에서 서비스 접속.
2. 학생 계정 로그인 후 과제 제출 및 LLM 자동 채점 실행.
3. 채점 완료 후 학생 결과 페이지(`evaluation-results.html`)에서 AI 관여도가 정상 표시되는지 확인.
4. 교수 계정 로그인 후 과제 평가 현황(`evaluation.html`)에서 전체 학생의 AI 관여도 컬럼 및 상세 모달 확인.
5. SQLite DB(`database.db`)의 `evaluations` 테이블에 `ai_involvement_score` 값이 정상 저장되었는지 확인.
