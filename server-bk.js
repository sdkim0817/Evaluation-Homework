const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
delete process.env.GOOGLE_API_KEY;

// LangChain & OpenAI 임포트 (오류 방지를 위해 dynamic require 처리 또는 try-catch 감싸기)
let ChatOpenAI;
try {
  ChatOpenAI = require('@langchain/openai').ChatOpenAI;
} catch (e) {
  console.warn('Warning: @langchain/openai module not loaded. Mock LLM will be used.');
}

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 세션 미들웨어
app.use(session({
  secret: 'homework-eval-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1일
}));

// 파일 업로드 설정 (uploads 디렉토리 자동 생성)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + encodeURIComponent(file.originalname));
  }
});
const upload = multer({ storage: storage });

// SQLite3 데이터베이스 초기화
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run("PRAGMA foreign_keys = ON;", (pragmaErr) => {
      if (pragmaErr) {
        console.error('Failed to enable foreign keys:', pragmaErr.message);
      } else {
        console.log('Foreign key support enabled.');
      }
    });
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // 개발 모드: 리셋을 위해 기존 테이블 드롭
    // db.run("DROP TABLE IF EXISTS evaluations");
    // db.run("DROP TABLE IF EXISTS submissions");
    // db.run("DROP TABLE IF EXISTS assignments");
    // db.run("DROP TABLE IF EXISTS courses");
    // db.run("DROP TABLE IF EXISTS users");

    // 1. 사용자 테이블
    db.run(`CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('student', 'professor')) NOT NULL,
      name TEXT NOT NULL
    )`);

    // 2. 강좌 테이블
    db.run(`CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL
    )`);

    // 3. 과제 테이블
    db.run(`CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      rubric TEXT NOT NULL,
      due_date TEXT NOT NULL,
      allowed_extensions TEXT,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    )`);

    // 4. 과제 제출 테이블
    db.run(`CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      student_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES users(username)
    )`);

    // 5. 평가 테이블
    db.run(`CREATE TABLE IF NOT EXISTS evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      feedback TEXT NOT NULL,
      evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    )`);

    // 초기 더미 사용자 계정 입력
    // const stmt = db.prepare("INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)");
    // stmt.run("professor1", "1234", "professor", "김교수");
    // stmt.run("student1", "1234", "student", "홍길동");
    // stmt.run("student2", "1234", "student", "이순신");
    // stmt.finalize();
    // console.log("Database initialized (all tables dropped and recreated with new schema).");
  });
}

// 로그인 세션 확인용 미들웨어
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Please login.' });
  }
}

function isProfessor(req, res, next) {
  if (req.session.user && req.session.user.role === 'professor') {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden. Professor only.' });
  }
}

// ------------------------- API Routes -------------------------

// 회원 가입 API
app.post('/api/signup', (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Username, password and name are required.' });
  }

  // 학번이 110528인 경우는 교수, 그 외에는 학생
  const role = (username === '110528') ? 'professor' : 'student';

  db.run(
    "INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)",
    [username, password, role, name],
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: 'Already registered username/student ID.' });
        }
        return res.status(500).json({ error: 'Database error: ' + err.message });
      }
      res.status(201).json({ message: 'User registered successfully', role });
    }
  );
});

// 로그인 API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error.' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    req.session.user = {
      username: user.username,
      role: user.role,
      name: user.name
    };
    res.json({ message: 'Login successful', user: req.session.user });
  });
});

// 로그아웃 API
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed.' });
    }
    res.json({ message: 'Logout successful' });
  });
});

// 내 정보 가져오기 API
app.get('/api/me', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// 강좌 목록 조회 API
app.get('/api/courses', isAuthenticated, (req, res) => {
  db.all("SELECT * FROM courses", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 특정 강좌 조회 API
app.get('/api/courses/:id', isAuthenticated, (req, res) => {
  db.get("SELECT * FROM courses WHERE id = ?", [req.params.id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json(row);
  });
});

// 강좌 생성 API (교수 전용)
app.post('/api/courses', isAuthenticated, isProfessor, (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required.' });
  }

  db.run("INSERT INTO courses (title, description) VALUES (?, ?)", [title, description], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ message: 'Course created successfully', courseId: this.lastID });
  });
});

// 강좌 수정 API (교수 전용)
app.put('/api/courses/:id', isAuthenticated, isProfessor, (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required.' });
  }

  db.run("UPDATE courses SET title = ?, description = ? WHERE id = ?", [title, description, req.params.id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    res.json({ message: 'Course updated successfully' });
  });
});

// 강좌 삭제 API (교수 전용)
app.delete('/api/courses/:id', isAuthenticated, isProfessor, (req, res) => {
  const courseId = req.params.id;

  // 1. 강좌에 속한 모든 과제의 제출 파일 경로 가져오기
  const selectFilesQuery = `
    SELECT file_path FROM submissions 
    WHERE assignment_id IN (SELECT id FROM assignments WHERE course_id = ?)
  `;

  db.all(selectFilesQuery, [courseId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve submission files: ' + err.message });
    }

    // 2. 물리 파일들 삭제
    if (rows && rows.length > 0) {
      rows.forEach(row => {
        if (row.file_path && fs.existsSync(row.file_path)) {
          try {
            fs.unlinkSync(row.file_path);
          } catch (unlinkErr) {
            console.error(`Failed to delete file: ${row.file_path}`, unlinkErr.message);
          }
        }
      });
    }

    // 3. DB 강좌 삭제 (Cascade로 하위 테이블 데이터 자동 삭제)
    db.run("DELETE FROM courses WHERE id = ?", [courseId], function (deleteErr) {
      if (deleteErr) {
        return res.status(500).json({ error: 'Failed to delete course: ' + deleteErr.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Course not found' });
      }
      res.json({ message: 'Course and all related data deleted successfully' });
    });
  });
});

// 특정 강좌의 과제 목록 조회 API
app.get('/api/courses/:courseId/assignments', isAuthenticated, (req, res) => {
  db.all("SELECT * FROM assignments WHERE course_id = ?", [req.params.courseId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 과제 생성 API (교수 전용)
app.post('/api/courses/:courseId/assignments', isAuthenticated, isProfessor, (req, res) => {
  const { title, description, rubric, due_date, allowed_extensions } = req.body;
  const courseId = req.params.courseId;

  if (!title || !description || !rubric || !due_date) {
    return res.status(400).json({ error: 'All fields (title, description, rubric, due_date) are required.' });
  }

  // 루브릭 검증 (JSON 구조여야 함)
  try {
    JSON.parse(rubric);
  } catch (e) {
    return res.status(400).json({ error: 'Rubric must be a valid JSON string.' });
  }

  db.run(
    "INSERT INTO assignments (course_id, title, description, rubric, due_date, allowed_extensions) VALUES (?, ?, ?, ?, ?, ?)",
    [courseId, title, description, rubric, due_date, allowed_extensions || ''],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ message: 'Assignment created successfully', assignmentId: this.lastID });
    }
  );
});

// 특정 과제의 정보 조회 API
app.get('/api/assignments/:id', isAuthenticated, (req, res) => {
  db.get("SELECT * FROM assignments WHERE id = ?", [req.params.id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Assignment not found' });
    }
    res.json(row);
  });
});

// 과제 수정 API (교수 전용)
app.put('/api/assignments/:id', isAuthenticated, isProfessor, (req, res) => {
  const { title, description, rubric, due_date, allowed_extensions } = req.body;
  const assignmentId = req.params.id;

  if (!title || !description || !rubric || !due_date) {
    return res.status(400).json({ error: 'All fields (title, description, rubric, due_date) are required.' });
  }

  // 루브릭 검증 (JSON 구조여야 함)
  try {
    JSON.parse(rubric);
  } catch (e) {
    return res.status(400).json({ error: 'Rubric must be a valid JSON string.' });
  }

  db.run(
    "UPDATE assignments SET title = ?, description = ?, rubric = ?, due_date = ?, allowed_extensions = ? WHERE id = ?",
    [title, description, rubric, due_date, allowed_extensions || '', assignmentId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Assignment not found' });
      }
      res.json({ message: 'Assignment updated successfully' });
    }
  );
});

// 과제 삭제 API (교수 전용)
app.delete('/api/assignments/:id', isAuthenticated, isProfessor, (req, res) => {
  const assignmentId = req.params.id;

  // 1. 해당 과제에 제출된 모든 파일 경로 조회
  db.all("SELECT file_path FROM submissions WHERE assignment_id = ?", [assignmentId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve submission files: ' + err.message });
    }

    // 2. 물리 파일들 삭제
    if (rows && rows.length > 0) {
      rows.forEach(row => {
        if (row.file_path && fs.existsSync(row.file_path)) {
          try {
            fs.unlinkSync(row.file_path);
          } catch (unlinkErr) {
            console.error(`Failed to delete file: ${row.file_path}`, unlinkErr.message);
          }
        }
      });
    }

    // 3. DB 과제 레코드 삭제 (Cascade 삭제)
    db.run("DELETE FROM assignments WHERE id = ?", [assignmentId], function (deleteErr) {
      if (deleteErr) {
        return res.status(500).json({ error: 'Failed to delete assignment: ' + deleteErr.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Assignment not found' });
      }
      res.json({ message: 'Assignment and all related submissions/evaluations deleted successfully' });
    });
  });
});

// 학생의 과제 제출 및 LangChain 기반 LLM 평가 API
app.post('/api/assignments/:assignmentId/submit', isAuthenticated, upload.single('assignmentFile'), async (req, res) => {
  const assignmentId = req.params.assignmentId;
  const studentId = req.session.user.username;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const filePath = req.file.path;
  const fileName = req.file.originalname;

  // 1. 과제 정보 및 강좌명 함께 가져오기
  db.get(
    "SELECT a.*, c.title as course_title FROM assignments a JOIN courses c ON a.course_id = c.id WHERE a.id = ?",
    [assignmentId],
    async (err, assignment) => {
      if (err || !assignment) {
        return res.status(404).json({ error: 'Assignment not found' });
      }

      // 허용된 확장자 검증
      if (assignment.allowed_extensions && assignment.allowed_extensions.trim() !== '') {
        const allowedList = assignment.allowed_extensions
          .split(',')
          .map(ext => ext.trim().toLowerCase())
          .filter(ext => ext !== '');

        if (allowedList.length > 0) {
          const fileExt = path.extname(fileName).toLowerCase().replace('.', '');
          if (!allowedList.includes(fileExt)) {
            if (fs.existsSync(filePath)) {
              try {
                fs.unlinkSync(filePath);
              } catch (unlinkErr) {
                console.error('Failed to delete invalid file:', unlinkErr.message);
              }
            }
            return res.status(400).json({
              error: `허용되지 않는 파일 형식입니다. (제출 가능 형식: ${assignment.allowed_extensions})`
            });
          }
        }
      }

      // 2. 업로드된 파일 내용 읽기 (텍스트 파일인지 확인하고 한계 용량 1MB 정도로 제어)
      let submissionContent = '';
      try {
        const stats = fs.statSync(filePath);
        if (stats.size > 1024 * 1024) {
          return res.status(400).json({ error: 'File size too large. Under 1MB only.' });
        }
        // 간단히 utf-8로 읽음. 텍스트가 아닌 경우에도 바이너리를 읽어 깨진 텍스트라도 LLM에 들어가거나 예외처리 유도.
        submissionContent = fs.readFileSync(filePath, 'utf-8');
      } catch (e) {
        submissionContent = `[바이너리 또는 텍스트가 아닌 파일: ${fileName}]`;
      }

      // 3. 이미 제출 이력이 있는지 확인하고 중복 제출 시 기존 정보 삭제 후 진행
      db.get(
        "SELECT id, file_path FROM submissions WHERE assignment_id = ? AND student_id = ?",
        [assignmentId, studentId],
        (findErr, existingSub) => {
          if (findErr) {
            return res.status(500).json({ error: 'Failed to check existing submission: ' + findErr.message });
          }

          const processNewSubmission = () => {
            db.run(
              "INSERT INTO submissions (assignment_id, student_id, file_path, file_name) VALUES (?, ?, ?, ?)",
              [assignmentId, studentId, filePath, fileName],
              async function (subErr) {
                if (subErr) {
                  return res.status(500).json({ error: 'Submission recording failed: ' + subErr.message });
                }
                const submissionId = this.lastID;

                // 4. LangChain & OpenAI API 연동 평가 수행
                let evalResult = { score: 0, feedback: '' };

                const apiKey = process.env.OPENAI_API_KEY;
                if (apiKey && ChatOpenAI) {
                  try {
                    const model = new ChatOpenAI({
                      modelName: "gpt-4o-mini",
                      apiKey: apiKey,
                      temperature: 0.2,
                    });

                    // 프롬프트 작성
                    const prompt = `
당신은 "${assignment.course_title}" 과제를 채점하고 피드백을 주는 전문적인 교수자입니다.
학생이 제출한 과제 내용을 아래의 과제 설명과 평가 루브릭을 바탕으로 엄격하고 공정하게 평가해 주세요.

[과제 제목]
${assignment.title}

[과제 설명]
${assignment.description}

[평가 루브릭 (JSON)]
${assignment.rubric}

[학생이 제출한 과제 내용]
---
${submissionContent}
---

[요구사항]
1. 루브릭의 각 항목별로 점수 배점 기준에 따라 공정하게 점수를 매겨주세요.
2. 모든 항목 점수의 합계를 계산해 최종 총점(score)을 부여해 주세요. (루브릭 총점 한도 내)
3. 학생에게 도움이 될 수 있는 구체적인 개선 사항과 잘한 점에 대해 간결한 피드백(feedback)을 한국어로 작성해 주세요.
4. 출력 결과는 반드시 다음과 같은 JSON 형식의 텍스트로만 제공되어야 합니다. 다른 말은 덧붙이지 마십시오.

\`\`\`json
{
  "score": [계산된 총점 (정수)],
  "feedback": "[루브릭 항목별 평가 내역과 종합 평가 피드백 (한국어)]"
}
\`\`\`
                  `;

                    const response = await model.invoke(prompt);
                    const responseText = response.content || response.text || '';

                    // JSON 추출 파싱
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                      const parsed = JSON.parse(jsonMatch[0]);
                      if (typeof parsed.score === 'number' && parsed.feedback) {
                        evalResult = parsed;
                      }
                    } else {
                      throw new Error("Invalid output format from LLM");
                    }
                  } catch (llmErr) {
                    console.error('LLM Evaluation Error:', llmErr.message);
                    // LLM 호출 실패 시 Mock 채점 (fallback)
                    evalResult = generateMockEvaluation(assignment.rubric, fileName);
                  }
                } else {
                  // API Key가 없거나 패키지 로드 안 된 경우 Mock 채점 수행
                  console.log("No GEMINI_API_KEY found or LangChain not initialized. Using Mock LLM.");
                  evalResult = generateMockEvaluation(assignment.rubric, fileName);
                }

                // 5. 평가 테이블에 저장
                db.run(
                  "INSERT INTO evaluations (submission_id, score, feedback) VALUES (?, ?, ?)",
                  [submissionId, evalResult.score, evalResult.feedback],
                  function (evalErr) {
                    if (evalErr) {
                      return res.status(500).json({ error: 'Evaluation saving failed: ' + evalErr.message });
                    }
                    res.json({
                      message: 'Evaluation completed successfully.',
                      submissionId: submissionId,
                      score: evalResult.score,
                      feedback: evalResult.feedback
                    });
                  }
                );
              }
            );
          };

          if (existingSub) {
            // 기존 파일 삭제
            if (existingSub.file_path && fs.existsSync(existingSub.file_path)) {
              try {
                fs.unlinkSync(existingSub.file_path);
              } catch (unlinkErr) {
                console.error(`Failed to delete previous file: ${existingSub.file_path}`, unlinkErr.message);
              }
            }
            // 기존 레코드 삭제 (ON DELETE CASCADE로 evaluations도 자동 삭제됨)
            db.run("DELETE FROM submissions WHERE id = ?", [existingSub.id], (delErr) => {
              if (delErr) {
                return res.status(500).json({ error: 'Failed to delete previous submission: ' + delErr.message });
              }
              processNewSubmission();
            });
          } else {
            processNewSubmission();
          }
        }
      );
    });
});

// Mock 채점 생성 헬퍼 함수
function generateMockEvaluation(rubricJson, fileName) {
  let maxTotal = 100;
  let items = [];
  try {
    const parsed = JSON.parse(rubricJson);
    if (Array.isArray(parsed)) {
      items = parsed;
      maxTotal = parsed.reduce((sum, item) => sum + (parseInt(item.max_score) || 0), 0);
    }
  } catch (e) { }

  // 80% ~ 95% 사이의 랜덤 점수 생성
  const percentage = 0.75 + Math.random() * 0.2;
  const score = Math.round(maxTotal * percentage);

  let feedback = `[알림: OpenAI API Key 미설정으로 시뮬레이션된 AI 채점 결과입니다]\n\n`;
  feedback += `제출하신 파일 '${fileName}'을 성공적으로 접수했습니다.\n\n`;
  feedback += `### [루브릭별 평가 의견]\n`;
  if (items.length > 0) {
    items.forEach(item => {
      const itemMax = parseInt(item.max_score) || 0;
      const itemScore = Math.round(itemMax * percentage);
      feedback += `- **${item.item}** (${itemScore} / ${itemMax}점): 제시된 조건에 맞추어 전반적으로 훌륭히 작성되었습니다.\n`;
    });
  } else {
    feedback += `- 전반적 구성 (점수 반영됨): 구조적인 전개가 뛰어나며 전달하고자 하는 주제가 명확합니다.\n`;
  }
  feedback += `\n### [총평]\n제시된 지침과 루브릭 조건을 충실히 반영하려 노력한 흔적이 돋보입니다. 몇 가지 세부 보완(자료 출처 표기 등)이 이루어지면 더욱 높은 완성도의 작업물이 될 것으로 기대합니다. 수고하셨습니다!`;

  return { score, feedback };
}

// 과제 제출 파일 일괄 삭제 API (교수 전용)
app.post('/api/assignments/:assignmentId/delete-files', isAuthenticated, isProfessor, (req, res) => {
  const assignmentId = req.params.assignmentId;

  // 1. 해당 과제의 제출 파일 경로 가져오기
  db.all("SELECT file_path FROM submissions WHERE assignment_id = ?", [assignmentId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to query submissions: ' + err.message });
    }

    // 2. 파일 물리적 삭제
    if (rows && rows.length > 0) {
      rows.forEach(row => {
        if (row.file_path && fs.existsSync(row.file_path)) {
          try {
            fs.unlinkSync(row.file_path);
          } catch (unlinkErr) {
            console.error(`Failed to delete file: ${row.file_path}`, unlinkErr.message);
          }
        }
      });
    }

    // 3. DB의 file_path 컬럼을 빈 값으로 업데이트
    db.run("UPDATE submissions SET file_path = '' WHERE assignment_id = ?", [assignmentId], function (updateErr) {
      if (updateErr) {
        return res.status(500).json({ error: 'Failed to update submissions: ' + updateErr.message });
      }
      res.json({ message: 'All files deleted and paths cleared successfully', count: this.changes });
    });
  });
});

// 교수가 특정 과제에 대해 제출된 모든 학생 결과 조회 API (교수 전용)
app.get('/api/assignments/:assignmentId/submissions', isAuthenticated, isProfessor, (req, res) => {
  const query = `
    SELECT 
      s.id as submission_id,
      s.student_id,
      u.name as student_name,
      s.file_name,
      s.file_path,
      s.submitted_at,
      e.score,
      e.feedback,
      e.evaluated_at
    FROM submissions s
    JOIN users u ON s.student_id = u.username
    LEFT JOIN evaluations e ON s.id = e.submission_id
    WHERE s.assignment_id = ?
    ORDER BY s.submitted_at DESC
  `;

  db.all(query, [req.params.assignmentId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 특정 제출의 평가 결과 상세 조회 API
app.get('/api/submissions/:submissionId/evaluation', isAuthenticated, (req, res) => {
  const query = `
    SELECT 
      s.id as submission_id,
      s.student_id,
      s.file_name,
      s.submitted_at,
      e.score,
      e.feedback,
      e.evaluated_at,
      a.title as assignment_title,
      a.description as assignment_description,
      a.rubric as assignment_rubric,
      a.course_id
    FROM submissions s
    JOIN assignments a ON s.assignment_id = a.id
    LEFT JOIN evaluations e ON s.id = e.submission_id
    WHERE s.id = ?
  `;

  db.get(query, [req.params.submissionId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // 학생인 경우 본인 제출물만 조회 가능하도록 권한 검사
    if (req.session.user.role === 'student' && req.session.user.username !== row.student_id) {
      return res.status(403).json({ error: 'Access denied. You can only view your own evaluation results.' });
    }

    res.json(row);
  });
});

// 학생 본인의 특정 과제 제출 및 평가 결과 단건 조회 API
app.get('/api/assignments/:assignmentId/my-submission', isAuthenticated, (req, res) => {
  const studentId = req.session.user.username;
  const query = `
    SELECT 
      s.id as submission_id,
      s.file_name,
      s.submitted_at,
      e.score,
      e.feedback
    FROM submissions s
    LEFT JOIN evaluations e ON s.id = e.submission_id
    WHERE s.assignment_id = ? AND s.student_id = ?
    ORDER BY s.submitted_at DESC
    LIMIT 1
  `;

  db.get(query, [req.params.assignmentId, studentId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(row || null); // 제출이 없으면 null 반환
  });
});

// 파일 다운로드 API (업로드된 원본 파일 다운로드)
app.get('/api/submissions/:submissionId/download', isAuthenticated, (req, res) => {
  db.get("SELECT * FROM submissions WHERE id = ?", [req.params.submissionId], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: 'File not found' });
    }

    // 학생인 경우 권한 체크
    if (req.session.user.role === 'student' && req.session.user.username !== row.student_id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // 파일이 디스크에 실제로 존재하는지 확인 (일괄 삭제되었거나 비어있을 경우)
    if (!row.file_path || !fs.existsSync(row.file_path)) {
      return res.status(410).json({ error: '서버 용량 관리를 위해 삭제된 파일입니다.' });
    }

    res.download(row.file_path, row.file_name);
  });
});

// 서버 구동
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
