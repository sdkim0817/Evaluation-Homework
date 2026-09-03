# AI 관여 수준(ai_involvement_score) 반영 완료보고서

제출물의 AI 관여 수준(0.0 ~ 1.0)을 평가 결과에 포함하여 LLM 프롬프트, JSON 출력 스키마, SQLite DB 저장, API 엔드포인트 및 프론트엔드 UI(학생/교수 화면)에 통합 반영하는 작업을 완료하였습니다.

---

## 주요 변경 및 반영 사항

### 1. LLM 프롬프트 및 JSON 스키마 ([server.js](file:///d:/Project/eval-assignment/antigravity_ver/server.js#L535-L567))
- **평가 지침 추가**: 제출물(코드/콘텐츠) 중 AI 도구의 도움을 받아 작성·수정되었을 것으로 추정되는 관여 수준(`ai_involvement_score`)을 0.0~1.0 사이의 실수로 측정하도록 지침 부여.
- **JSON 스키마 정의**:
  ```json
  {
    "score": [계산된 총점 (정수)],
    "feedback": "[루브릭 항목별 평가 내역과 종합 평가 피드백 (한국어)]",
    "ai_involvement_score": [0.0에서 1.0 사이의 AI 관여도 추정 실수값]
  }
  ```

### 2. 데이터베이스 스키마 및 마이그레이션 ([server.js](file:///d:/Project/eval-assignment/antigravity_ver/server.js#L116-L130))
- `evaluations` 테이블에 `ai_involvement_score REAL DEFAULT 0.0` 컬럼 정의.
- 기존 DB 연동을 위한 마이그레이션 구문 반영 (`ALTER TABLE evaluations ADD COLUMN ai_involvement_score REAL DEFAULT 0.0`).

### 3. 평가 결과 파싱, DB 저장 및 API 조회 ([server.js](file:///d:/Project/eval-assignment/antigravity_ver/server.js#L575-L615))
- LLM 출력 JSON에서 `ai_involvement_score`를 파싱하여 [0.0, 1.0] 범위로 클램핑 처리.
- `INSERT INTO evaluations (submission_id, score, feedback, ai_involvement_score)` 파라미터 바인딩 및 저장.
- 학생/교수용 제출 조회 API(`GET /api/assignments/:assignmentId/submissions`, `GET /api/submissions/:submissionId/evaluation`, `GET /api/assignments/:assignmentId/my-submission`)의 `SELECT` 쿼리에 `ai_involvement_score` 포함.

### 4. 프론트엔드 UI 시각화
- **학생용 결과 확인 화면 ([evaluation-results.html](file:///d:/Project/eval-assignment/antigravity_ver/public/evaluation-results.html#L57-L60))**:
  - 요약 카드에 `AI 관여도 추정` 표시 영역 배치 (`35% (0.35)` 형식).
- **교수용 현황 화면 ([evaluation.html](file:///d:/Project/eval-assignment/antigravity_ver/public/evaluation.html#L75-L101))**:
  - 제출 목록 테이블 컬럼(`AI 관여도 추정`) 및 상세 피드백 모달 내 `AI 관여도 추정` 배지 구현.

---

## 검증 결과 (Verification Results)

1. **구문 검증 (Node.js Syntax Check)**
   - Command: `node -c server.js`
   - 결과: 오류 없이 정성 구문 검증 완료.

2. **데이터베이스 구조 검증**
   - SQLite DB `PRAGMA table_info(evaluations)` 실행을 통해 `ai_involvement_score (REAL)` 컬럼 정상 생성 및 조회 확인.
