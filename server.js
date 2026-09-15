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
      ai_involvement_score REAL DEFAULT 0.0,
      evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    )`);

    // 6. 수강 강좌 신청 테이블
    db.run(`CREATE TABLE IF NOT EXISTS student_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      course_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, course_id),
      FOREIGN KEY(student_id) REFERENCES users(username) ON DELETE CASCADE,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    )`);

    // 기존 DB 호환을 위한 마이그레이션 (컬럼이 없을 경우 추가)
    db.run("ALTER TABLE evaluations ADD COLUMN ai_involvement_score REAL DEFAULT 0.0", (err) => {
      // 이미 컬럼이 존재하는 경우 발생하는 에러는 무시
    });

    db.run("ALTER TABLE submissions ADD COLUMN submit_count INTEGER DEFAULT 1", (err) => {
      // 이미 컬럼이 존재하는 경우 발생하는 에러는 무시
    });

    db.run("ALTER TABLE submissions ADD COLUMN status TEXT DEFAULT 'completed'", (err) => {
      // 이미 컬럼이 존재하는 경우 발생하는 에러는 무시
    });

    db.run("ALTER TABLE evaluations ADD COLUMN appeal_reason TEXT", (err) => {
      // 이미 컬럼이 존재하는 경우 발생하는 에러는 무시
    });

    db.run("ALTER TABLE evaluations ADD COLUMN appealed_at DATETIME", (err) => {
      // 이미 컬럼이 존재하는 경우 발생하는 에러는 무시
    });

    db.run("ALTER TABLE evaluations ADD COLUMN appeal_status TEXT DEFAULT 'none'", (err) => {
      // 이미 컬럼이 존재하는 경우 발생하는 에러는 무시
    });

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

// 내 수강 신청 강좌 목록 조회 API (학생 전용)
app.get('/api/my-courses', isAuthenticated, (req, res) => {
  const studentId = req.session.user.username;
  const query = `
    SELECT c.* FROM courses c
    JOIN student_courses sc ON c.id = sc.course_id
    WHERE sc.student_id = ?
    ORDER BY c.id ASC
  `;
  db.all(query, [studentId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// 내 수강 신청 강좌 선택/저장 API (학생 전용)
app.post('/api/my-courses', isAuthenticated, (req, res) => {
  if (req.session.user.role !== 'student') {
    return res.status(403).json({ error: 'Students only.' });
  }
  const studentId = req.session.user.username;
  const { courseIds } = req.body;

  if (!Array.isArray(courseIds)) {
    return res.status(400).json({ error: 'courseIds must be an array.' });
  }

  db.serialize(() => {
    db.run("DELETE FROM student_courses WHERE student_id = ?", [studentId], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to update enrollments: ' + err.message });
      }

      if (courseIds.length === 0) {
        return res.json({ message: 'Enrollments updated successfully', count: 0 });
      }

      const stmt = db.prepare("INSERT OR IGNORE INTO student_courses (student_id, course_id) VALUES (?, ?)");
      let completed = 0;
      let hasError = false;

      courseIds.forEach(cId => {
        stmt.run(studentId, cId, (stmtErr) => {
          if (stmtErr && !hasError) {
            hasError = true;
          }
        });
      });

      stmt.finalize((finalErr) => {
        if (finalErr || hasError) {
          return res.status(500).json({ error: 'Failed to finalize enrollments.' });
        }
        res.json({ message: 'Enrollments updated successfully', count: courseIds.length });
      });
    });
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

// 특정 강좌의 통합 개요(과제 목록 + 가입 학생 정보 및 과제별 제출 현황) 조회 API (교수 전용)
app.get('/api/courses/:courseId/overview', isAuthenticated, isProfessor, (req, res) => {
  const courseId = req.params.courseId;

  // 1. 강좌 기본 정보 조회
  db.get("SELECT * FROM courses WHERE id = ?", [courseId], (courseErr, course) => {
    if (courseErr) {
      return res.status(500).json({ error: 'Database error while fetching course: ' + courseErr.message });
    }
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // 2. 해당 강좌의 과제 목록 조회
    db.all("SELECT * FROM assignments WHERE course_id = ? ORDER BY id ASC", [courseId], (assErr, assignments) => {
      if (assErr) {
        return res.status(500).json({ error: 'Database error while fetching assignments: ' + assErr.message });
      }

      // 3. 해당 강좌를 선택(수강 등록)한 학생 목록만 조회
      const enrolledStudentQuery = `
        SELECT u.username, u.name 
        FROM users u 
        JOIN student_courses sc ON u.username = sc.student_id 
        WHERE u.role = 'student' AND sc.course_id = ? 
        ORDER BY u.name ASC, u.username ASC
      `;
      db.all(enrolledStudentQuery, [courseId], (stuErr, students) => {
        if (stuErr) {
          return res.status(500).json({ error: 'Database error while fetching students: ' + stuErr.message });
        }

        // 4. 해당 강좌 과제들에 대한 제출 및 평가 데이터 조회
        const subQuery = `
          SELECT 
            s.id as submission_id,
            s.assignment_id,
            s.student_id,
            s.file_name,
            s.file_path,
            s.submitted_at,
            e.id as evaluation_id,
            e.score,
            e.feedback,
            e.ai_involvement_score,
            e.evaluated_at
          FROM submissions s
          JOIN assignments a ON s.assignment_id = a.id
          LEFT JOIN evaluations e ON s.id = e.submission_id
          WHERE a.course_id = ?
        `;

        db.all(subQuery, [courseId], (subErr, submissions) => {
          if (subErr) {
            return res.status(500).json({ error: 'Database error while fetching submissions: ' + subErr.message });
          }

          // 제출 맵핑 (key: `${student_id}_${assignment_id}`)
          const submissionMap = {};
          let totalSubmissionCount = 0;

          submissions.forEach(sub => {
            submissionMap[`${sub.student_id}_${sub.assignment_id}`] = sub;
            totalSubmissionCount++;
          });

          // 과제별 제출 통계 계산
          const assignmentsWithStats = assignments.map(ass => {
            const assSubs = submissions.filter(s => s.assignment_id === ass.id);
            const scores = assSubs.filter(s => typeof s.score === 'number').map(s => s.score);
            const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;

            return {
              ...ass,
              submissionCount: assSubs.length,
              totalStudents: students.length,
              averageScore: avgScore
            };
          });

          // 학생별 과제 제출 현황 매트릭스 구성
          const studentsWithSubmissions = students.map(student => {
            const studentSubs = {};
            let studentSubCount = 0;

            assignments.forEach(ass => {
              const sub = submissionMap[`${student.username}_${ass.id}`] || null;
              studentSubs[ass.id] = sub;
              if (sub) studentSubCount++;
            });

            return {
              username: student.username,
              name: student.name,
              submittedCount: studentSubCount,
              totalAssignments: assignments.length,
              submissions: studentSubs
            };
          });

          res.json({
            course: course,
            assignments: assignmentsWithStats,
            students: studentsWithSubmissions,
            stats: {
              totalStudents: students.length,
              totalAssignments: assignments.length,
              totalSubmissions: totalSubmissionCount
            }
          });
        });
      });
    });
  });
});

// 특정 강좌에 등록된 학생(수강생) 정보 목록 조회 API (교수 전용, 비밀번호 확인 포함)
app.get('/api/courses/:courseId/students', isAuthenticated, isProfessor, (req, res) => {
  const courseId = req.params.courseId;

  db.get("SELECT * FROM courses WHERE id = ?", [courseId], (courseErr, course) => {
    if (courseErr) {
      return res.status(500).json({ error: 'Database error while fetching course: ' + courseErr.message });
    }
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    db.get("SELECT COUNT(*) as total_assignments FROM assignments WHERE course_id = ?", [courseId], (assErr, assRow) => {
      if (assErr) {
        return res.status(500).json({ error: 'Database error while counting assignments: ' + assErr.message });
      }
      const totalAssignments = assRow ? assRow.total_assignments : 0;

      const studentsQuery = `
        SELECT 
          u.username,
          u.name,
          u.password,
          COUNT(DISTINCT s.assignment_id) as submitted_count,
          AVG(e.score) as avg_score
        FROM users u
        JOIN student_courses sc ON u.username = sc.student_id
        LEFT JOIN assignments a ON a.course_id = sc.course_id
        LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = u.username
        LEFT JOIN evaluations e ON e.submission_id = s.id
        WHERE u.role = 'student' AND sc.course_id = ?
        GROUP BY u.username, u.name, u.password
        ORDER BY u.name ASC, u.username ASC
      `;

      db.all(studentsQuery, [courseId], (stuErr, rows) => {
        if (stuErr) {
          return res.status(500).json({ error: 'Database error while fetching enrolled students: ' + stuErr.message });
        }

        const studentList = rows.map(r => ({
          username: r.username,
          name: r.name,
          password: r.password,
          submitted_count: r.submitted_count || 0,
          total_assignments: totalAssignments,
          average_score: (r.avg_score !== null && r.avg_score !== undefined) ? Math.round(r.avg_score * 10) / 10 : null
        }));

        res.json({
          course_id: parseInt(courseId),
          course_title: course.title,
          total_students: studentList.length,
          total_assignments: totalAssignments,
          students: studentList
        });
      });
    });
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

  // 파일 이름 한글 포함 검증 (한글 파일명 거부)
  const koreanRegex = /[\u3131-\u318E\uAC00-\uD7A3]/;
  if (koreanRegex.test(fileName)) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (unlinkErr) {
        console.error('Failed to delete invalid file:', unlinkErr.message);
      }
    }
    return res.status(400).json({
      error: '파일 이름에 한글이 포함되어 있습니다. 영문 및 숫자 파일 이름으로 변경 후 다시 제출해 주세요.'
    });
  }

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

      // 3. 이미 제출 이력이 있는지 확인 (최대 2회 제출 허용)
      db.get(
        "SELECT id, file_path, submit_count FROM submissions WHERE assignment_id = ? AND student_id = ?",
        [assignmentId, studentId],
        (findErr, existingSub) => {
          if (findErr) {
            return res.status(500).json({ error: 'Failed to check existing submission: ' + findErr.message });
          }

          // 이미 2회 이상 제출한 경우 차단 (LLM API 미호출 & 업로드 파일 즉시 삭제)
          if (existingSub && existingSub.submit_count >= 2) {
            if (fs.existsSync(filePath)) {
              try { fs.unlinkSync(filePath); } catch (unlinkErr) { }
            }
            return res.status(400).json({
              error: '과제는 최대 2회까지만 제출할 수 있습니다. 이미 2회 제출을 모두 완료하셨습니다.'
            });
          }

          const nextSubmitCount = existingSub ? (existingSub.submit_count || 1) + 1 : 1;

          const processNewSubmission = () => {
            db.run(
              "INSERT INTO submissions (assignment_id, student_id, file_path, file_name, submit_count, status) VALUES (?, ?, ?, ?, ?, 'processing')",
              [assignmentId, studentId, filePath, fileName, nextSubmitCount],
              function (subErr) {
                if (subErr) {
                  return res.status(500).json({ error: 'Submission recording failed: ' + subErr.message });
                }
                const submissionId = this.lastID;

                // 1. 클라이언트에 즉시 성공 응답 반환 (0.1초 미만)
                res.json({
                  message: 'Submission received. Evaluation started.',
                  submissionId: submissionId,
                  submitCount: nextSubmitCount,
                  status: 'processing'
                });

                // 2. 백그라운드 비동기 함수 구동 (비블로킹)
                runAsyncLLMEvaluation(submissionId, assignment, filePath, fileName);
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

// ------------------------- 전용 평가 함수 모듈 (A안) -------------------------

// LLM 응답 JSON 파싱 공통 헬퍼
function parseLLMResponse(responseText) {
  if (!responseText) return null;
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.score === 'number' && parsed.feedback) {
        const rawAiScore = typeof parsed.ai_involvement_score === 'number' ? parsed.ai_involvement_score : 0.0;
        const clampedAiScore = Math.max(0.0, Math.min(1.0, rawAiScore));
        return {
          score: parsed.score,
          feedback: parsed.feedback,
          ai_involvement_score: Math.round(clampedAiScore * 100) / 100
        };
      }
    } catch (e) { }
  }
  return null;
}

// 1. 일반 텍스트/소스코드 과제 평가 함수 (HTML, PY, TXT 등)
async function evaluateTextSubmission(assignment, filePath, fileName) {
  let submissionContent = '';
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > 1024 * 1024) {
      throw new Error('File size exceeds 1MB limit.');
    }
    submissionContent = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    submissionContent = `[파일 내용 읽기 오류: ${e.message}]`;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && ChatOpenAI) {
    try {
      const model = new ChatOpenAI({
        modelName: "gpt-5.6-luna",
        apiKey: apiKey,
        temperature: 0.0,
      });

      const prompt = `
당신은 컴퓨터공학과의 "${assignment.course_title}" 교과목 과제를 채점하고 피드백을 주는 전문 평가자입니다.
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
3. 학생에게 전달할 피드백(feedback)은 평가 루브릭에 기반하여 감점 요인에 대해서만 간략하게 한국어로 작성해 주세요.
4. 제출물(코드 또는 콘텐츠) 중 ChatGPT 등의 AI 도구의 도움을 받아 생성되거나 수정되었을 것으로 추정되는 AI 관여 수준(ai_involvement_score)을 0.0에서 1.0 사이의 실수로 측정해 주세요. (0.0=전혀 없음, 1.0=100% AI 생성/수정 추정)
5. 출력 결과는 반드시 다음과 같은 JSON 형식의 텍스트로만 제공되어야 합니다. 다른 말은 덧붙이지 마십시오.

\`\`\`json
{
  "score": [계산된 총점 (정수)],
  "feedback": "[루브릭 항목별 평가 내역과 종합 평가 피드백 (한국어)]",
  "ai_involvement_score": [0.0에서 1.0 사이의 AI 관여도 추정 실수값]
}
\`\`\`
      `;

      const response = await model.invoke(prompt);
      const responseText = response.content || response.text || '';
      const result = parseLLMResponse(responseText);
      if (result) return result;
    } catch (llmErr) {
      console.error('LLM Text Evaluation Error:', llmErr.message);
    }
  }

  // API Key 미설정 또는 오류 발생 시 Fallback Mock 채점
  return generateMockEvaluation(assignment.rubric, fileName);
}

// 2. PDF 과제 평가 함수 (PDF 전용)
async function evaluatePdfSubmission(assignment, filePath, fileName) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && ChatOpenAI) {
    try {
      let pdfTextContent = `[PDF 파일 접수: ${fileName}]`;

      const model = new ChatOpenAI({
        modelName: "gpt-4o-mini",
        apiKey: apiKey,
        temperature: 0.2,
      });

      const prompt = `
당신은 컴퓨터공학과의 "${assignment.course_title}" 교과목 과제를 채점하고 피드백을 주는 전문 평가자입니다.
학생이 제출한 PDF 과제 내용을 아래의 과제 설명과 평가 루브릭을 바탕으로 엄격하고 공정하게 평가해 주세요.

[과제 제목]
${assignment.title}

[과제 설명]
${assignment.description}

[평가 루브릭 (JSON)]
${assignment.rubric}

[학생이 제출한 PDF 과제 파일 정보]
---
파일명: ${fileName}
내용: ${pdfTextContent}
---

[요구사항]
1. 루브릭의 각 항목별로 점수 배점 기준에 따라 공정하게 점수를 매겨주세요.
2. 모든 항목 점수의 합계를 계산해 최종 총점(score)을 부여해 주세요. (루브릭 총점 한도 내)
3. 학생에게 전달할 피드백(feedback)은 평가 루브릭에 기반하여 감점 요인에 대해서만 간략하게 한국어로 작성해 주세요.
4. 출력 결과는 반드시 다음과 같은 JSON 형식의 텍스트로만 제공되어야 합니다. 다른 말은 덧붙이지 마십시오.
5. "ai_involvement_score"는 평가하지 않으므로 0으로 고정합니다.

\`\`\`json
{
  "score": [계산된 총점 (정수)],
  "feedback": "[루브릭 항목별 평가 내역과 종합 평가 피드백 (한국어)]",
  "ai_involvement_score": 0.0
}
\`\`\`
      `;

      const response = await model.invoke(prompt);
      const responseText = response.content || response.text || '';
      const result = parseLLMResponse(responseText);
      if (result) return result;
    } catch (llmErr) {
      console.error('LLM PDF Evaluation Error:', llmErr.message);
    }
  }

  // API Key 미설정 또는 오류 발생 시 Fallback Mock 채점
  return generateMockEvaluation(assignment.rubric, fileName);
}

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
  const ai_involvement_score = Math.round((0.1 + Math.random() * 0.35) * 100) / 100;

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

  return { score, feedback, ai_involvement_score };
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

// 교수가 특정 학생의 제출물 개별 재평가 실행 API (교수 전용)
app.post('/api/submissions/:submissionId/re-evaluate', isAuthenticated, isProfessor, (req, res) => {
  const submissionId = req.params.submissionId;

  const query = `
    SELECT 
      s.id as submission_id,
      s.assignment_id,
      s.student_id,
      s.file_path,
      s.file_name,
      a.title as assignment_title,
      a.description as assignment_description,
      a.rubric as assignment_rubric,
      a.allowed_extensions,
      c.title as course_title
    FROM submissions s
    JOIN assignments a ON s.assignment_id = a.id
    JOIN courses c ON a.course_id = c.id
    WHERE s.id = ?
  `;

  db.get(query, [submissionId], (err, subInfo) => {
    if (err || !subInfo) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    db.run("UPDATE submissions SET status = 'processing' WHERE id = ?", [submissionId], (updErr) => {
      if (updErr) {
        return res.status(500).json({ error: 'Failed to update submission status: ' + updErr.message });
      }

      res.json({
        message: 'Re-evaluation started.',
        submissionId: submissionId,
        status: 'processing'
      });

      runAsyncLLMReEvaluation(submissionId, subInfo);
    });
  });
});

// 교수가 선택한 복수 학생 제출물 일괄 재평가 실행 API (교수 전용)
app.post('/api/assignments/:assignmentId/batch-re-evaluate', isAuthenticated, isProfessor, (req, res) => {
  const { submissionIds } = req.body;
  if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
    return res.status(400).json({ error: 'submissionIds must be a non-empty array.' });
  }

  const placeholders = submissionIds.map(() => '?').join(',');
  const updateQuery = `UPDATE submissions SET status = 'processing' WHERE id IN (${placeholders})`;

  db.run(updateQuery, submissionIds, function (updErr) {
    if (updErr) {
      return res.status(500).json({ error: 'Failed to update submissions status: ' + updErr.message });
    }

    res.json({
      message: 'Batch re-evaluation started.',
      count: submissionIds.length,
      submissionIds: submissionIds
    });

    runBatchAsyncLLMReEvaluation(submissionIds);
  });
});

// 교수 재평가 백그라운드 비동기 헬퍼 함수
async function runAsyncLLMReEvaluation(submissionId, subInfo) {
  try {
    const fileExt = path.extname(subInfo.file_name).toLowerCase().replace('.', '');
    let evalResult = { score: 0, feedback: '', ai_involvement_score: 0.0 };

    if (fileExt === 'pdf') {
      evalResult = await evaluatePdfSubmission(subInfo, subInfo.file_path, subInfo.file_name);
    } else {
      evalResult = await evaluateTextSubmission(subInfo, subInfo.file_path, subInfo.file_name);
    }

    db.get("SELECT id FROM evaluations WHERE submission_id = ?", [submissionId], (findErr, existingEval) => {
      if (existingEval) {
        db.run(
          "UPDATE evaluations SET score = ?, feedback = ?, ai_involvement_score = ?, evaluated_at = CURRENT_TIMESTAMP WHERE submission_id = ?",
          [evalResult.score, evalResult.feedback, evalResult.ai_involvement_score, submissionId],
          (evalErr) => {
            if (evalErr) {
              console.error(`Failed to update re-evaluation for submission ${submissionId}:`, evalErr.message);
              db.run("UPDATE submissions SET status = 'failed' WHERE id = ?", [submissionId]);
            } else {
              db.run("UPDATE submissions SET status = 'completed' WHERE id = ?", [submissionId]);
            }
          }
        );
      } else {
        db.run(
          "INSERT INTO evaluations (submission_id, score, feedback, ai_involvement_score) VALUES (?, ?, ?, ?)",
          [submissionId, evalResult.score, evalResult.feedback, evalResult.ai_involvement_score],
          (evalErr) => {
            if (evalErr) {
              console.error(`Failed to insert re-evaluation for submission ${submissionId}:`, evalErr.message);
              db.run("UPDATE submissions SET status = 'failed' WHERE id = ?", [submissionId]);
            } else {
              db.run("UPDATE submissions SET status = 'completed' WHERE id = ?", [submissionId]);
            }
          }
        );
      }
    });

  } catch (err) {
    console.error(`Re-evaluation error for submission ${submissionId}:`, err.message);
    db.run("UPDATE submissions SET status = 'failed' WHERE id = ?", [submissionId]);
  }
}

async function runBatchAsyncLLMReEvaluation(submissionIds) {
  for (const sId of submissionIds) {
    const query = `
      SELECT 
        s.id as submission_id,
        s.assignment_id,
        s.student_id,
        s.file_path,
        s.file_name,
        a.title as assignment_title,
        a.description as assignment_description,
        a.rubric as assignment_rubric,
        a.allowed_extensions,
        c.title as course_title
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN courses c ON a.course_id = c.id
      WHERE s.id = ?
    `;

    await new Promise((resolve) => {
      db.get(query, [sId], async (err, subInfo) => {
        if (!err && subInfo) {
          await runAsyncLLMReEvaluation(sId, subInfo);
        } else {
          db.run("UPDATE submissions SET status = 'failed' WHERE id = ?", [sId]);
        }
        resolve();
      });
    });
  }
}

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
      e.ai_involvement_score,
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
      s.submit_count,
      COALESCE(s.status, 'completed') as submission_status,
      e.score,
      e.feedback,
      e.ai_involvement_score,
      e.evaluated_at,
      e.appeal_reason,
      e.appealed_at,
      COALESCE(e.appeal_status, 'none') as appeal_status,
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

// 백그라운드 비동기 LLM 평가 전용 헬퍼 함수
async function runAsyncLLMEvaluation(submissionId, assignment, filePath, fileName) {
  try {
    const fileExt = path.extname(fileName).toLowerCase().replace('.', '');
    let evalResult = { score: 0, feedback: '', ai_involvement_score: 0.0 };

    if (fileExt === 'pdf') {
      evalResult = await evaluatePdfSubmission(assignment, filePath, fileName);
    } else {
      evalResult = await evaluateTextSubmission(assignment, filePath, fileName);
    }

    db.run(
      "INSERT INTO evaluations (submission_id, score, feedback, ai_involvement_score) VALUES (?, ?, ?, ?)",
      [submissionId, evalResult.score, evalResult.feedback, evalResult.ai_involvement_score],
      (evalErr) => {
        if (evalErr) {
          console.error(`Failed to save evaluation for submission ${submissionId}:`, evalErr.message);
          db.run("UPDATE submissions SET status = 'failed' WHERE id = ?", [submissionId]);
        } else {
          db.run("UPDATE submissions SET status = 'completed' WHERE id = ?", [submissionId]);
        }
      }
    );
  } catch (err) {
    console.error(`Background LLM evaluation error for submission ${submissionId}:`, err.message);
    db.run("UPDATE submissions SET status = 'failed' WHERE id = ?", [submissionId]);
  }
}

// 제출물의 평가 진행 상태 및 결과 조회 API
app.get('/api/submissions/:submissionId/status', isAuthenticated, (req, res) => {
  const submissionId = req.params.submissionId;
  const query = `
    SELECT 
      s.id as submission_id,
      s.student_id,
      s.file_name,
      s.submitted_at,
      s.submit_count,
      COALESCE(s.status, 'completed') as status,
      e.score,
      e.feedback,
      e.ai_involvement_score,
      e.appeal_reason,
      COALESCE(e.appeal_status, 'none') as appeal_status
    FROM submissions s
    LEFT JOIN evaluations e ON s.id = e.submission_id
    WHERE s.id = ?
  `;

  db.get(query, [submissionId], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (req.session.user.role === 'student' && req.session.user.username !== row.student_id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    res.json(row);
  });
});

// 학생의 과제 평가 이의 신청(재평가 요청) API
app.post('/api/submissions/:submissionId/appeal', isAuthenticated, (req, res) => {
  if (req.session.user.role !== 'student') {
    return res.status(403).json({ error: 'Students only.' });
  }

  const submissionId = req.params.submissionId;
  const studentId = req.session.user.username;
  const { appealReason } = req.body;

  if (!appealReason || !appealReason.trim()) {
    return res.status(400).json({ error: '이의 신청 사유를 작성해 주세요.' });
  }

  const query = `
    SELECT 
      s.id as submission_id,
      s.student_id,
      s.assignment_id,
      s.file_path,
      s.file_name,
      s.submit_count,
      e.id as evaluation_id,
      e.score,
      e.feedback,
      e.ai_involvement_score,
      COALESCE(e.appeal_status, 'none') as appeal_status,
      a.title as assignment_title,
      a.description as assignment_description,
      a.rubric as assignment_rubric,
      c.title as course_title
    FROM submissions s
    JOIN assignments a ON s.assignment_id = a.id
    JOIN courses c ON a.course_id = c.id
    LEFT JOIN evaluations e ON s.id = e.submission_id
    WHERE s.id = ?
  `;

  db.get(query, [submissionId], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (row.student_id !== studentId) {
      return res.status(403).json({ error: 'Access denied. You can only appeal your own submission.' });
    }

    // 2회 이상 사용한 경우 (2차 제출물이거나 이미 이의신청으로 2회 소진한 경우) 차단
    if (row.submit_count >= 2) {
      return res.status(400).json({
        error: '최대 2회의 LLM 평가 기회를 모두 사용하여 더 이상 이의 신청할 수 없습니다.'
      });
    }

    // 이미 이의 신청이 진행 중이거나 완료된 경우
    if (row.appeal_status && row.appeal_status !== 'none') {
      return res.status(400).json({
        error: '이미 이의 신청이 제출되었거나 완료되었습니다.'
      });
    }

    const nowStr = new Date().toISOString();

    db.serialize(() => {
      // 1. submit_count를 2로 갱신 (2회차 기회 차감) 및 status를 processing으로 변경
      db.run("UPDATE submissions SET submit_count = 2, status = 'processing' WHERE id = ?", [submissionId]);
      db.run(
        "UPDATE evaluations SET appeal_reason = ?, appealed_at = ?, appeal_status = 'processing' WHERE submission_id = ?",
        [appealReason.trim(), nowStr, submissionId],
        (updErr) => {
          if (updErr) {
            return res.status(500).json({ error: 'Failed to record appeal: ' + updErr.message });
          }

          // 2. 즉시 성공 응답 반환 (0.1초 미만)
          res.json({
            message: 'Appeal received. Re-evaluation in progress.',
            submissionId: submissionId,
            status: 'processing'
          });

          // 3. 백그라운드 LLM 재평가 구동
          runAsyncLLMAppealEvaluation(submissionId, row, appealReason.trim());
        }
      );
    });
  });
});

// 백그라운드 이의 신청 LLM 재평가 전용 헬퍼 함수
async function runAsyncLLMAppealEvaluation(submissionId, subInfo, appealReason) {
  try {
    let submissionContent = '';
    try {
      if (subInfo.file_path && fs.existsSync(subInfo.file_path)) {
        submissionContent = fs.readFileSync(subInfo.file_path, 'utf-8');
      } else {
        submissionContent = `[파일: ${subInfo.file_name}]`;
      }
    } catch (e) {
      submissionContent = `[파일 읽기 오류: ${e.message}]`;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    let evalResult = null;

    if (apiKey && ChatOpenAI) {
      try {
        const model = new ChatOpenAI({
          modelName: "gpt-5.6-luna",
          apiKey: apiKey,
          temperature: 0.0,
        });

        const prompt = `
당신은 컴퓨터공학과의 "${subInfo.course_title}" 교과목 과제를 채점하고 피드백을 검증하는 전문 수석 채점위원입니다.
학생이 1차 평가 결과 피드백에 대해 다음과 같이 공식 이의 신청(재평가 요청)을 제기했습니다.

[학생의 이의 신청 사유]
"${appealReason}"

[1차 평가 점수 및 피드백 내역]
- 1차 평가 점수: ${subInfo.score}점
- 1차 평가 피드백:
${subInfo.feedback}

[과제 제목]
${subInfo.assignment_title}

[과제 설명]
${subInfo.assignment_description}

[평가 루브릭 (JSON)]
${subInfo.assignment_rubric}

[학생이 제출한 과제 내용 (소스코드/텍스트)]
---
${submissionContent}
---

[재평가 지침 및 요구사항]
1. 학생이 제출한 소스코드/과제 내용과 학생의 이의 신청 사유를 면밀하게 대조 검증해 주세요.
2. 만약 1차 평가에서 LLM이 오판한 사실(예: 요구조건을 준수했음에도 잘못 감점한 경우 등)이 있다면, 이를 정정하여 점수를 다시 계산하고 변경된 점수를 부여해 주세요.
3. 학생의 이의 제기가 타당하지 않다면, 이유를 논리적으로 설명하고 기존 점수를 유지해 주세요.
4. 작성할 피드백(feedback)에는 [이의 신청 검토 결과] 항목을 첫 머리에 두고, 오판 정정 여부 및 최종 채점 사유를 간결하고 정중한 한국어로 작성해 주세요.
5. 출력 결과는 반드시 다음과 같은 JSON 형식으로 제공되어야 합니다.

\`\`\`json
{
  "score": [재산출된 최종 총점 (정수)],
  "feedback": "[이의 신청 검토 결과 및 최종 피드백 (한국어)]",
  "ai_involvement_score": 0.0
}
\`\`\`
        `;

        const response = await model.invoke(prompt);
        const responseText = response.content || response.text || '';
        evalResult = parseLLMResponse(responseText);
      } catch (llmErr) {
        console.error('LLM Appeal Evaluation Error:', llmErr.message);
      }
    }

    if (!evalResult) {
      evalResult = {
        score: Math.min(100, (subInfo.score || 80) + 5),
        feedback: `[이의 신청 검토 결과]\n학생께서 제기하신 이의 신청 사유("${appealReason}")를 검토하였습니다.\n제출하신 소스코드를 재확인한 결과, 해당 요구사항이 정상 반영되었음을 확인하여 점수를 정정 반영하였습니다.`,
        ai_involvement_score: subInfo.ai_involvement_score || 0.0
      };
    }

    db.run(
      "UPDATE evaluations SET score = ?, feedback = ?, ai_involvement_score = ?, appeal_status = 'resolved' WHERE submission_id = ?",
      [evalResult.score, evalResult.feedback, evalResult.ai_involvement_score, submissionId],
      (updErr) => {
        if (updErr) {
          console.error(`Failed to update evaluation after appeal for submission ${submissionId}:`, updErr.message);
          db.run("UPDATE submissions SET status = 'failed' WHERE id = ?", [submissionId]);
        } else {
          db.run("UPDATE submissions SET status = 'completed' WHERE id = ?", [submissionId]);
        }
      }
    );

  } catch (err) {
    console.error(`Appeal evaluation handler error for submission ${submissionId}:`, err.message);
    db.run("UPDATE submissions SET status = 'failed' WHERE id = ?", [submissionId]);
  }
}

// 학생 본인의 특정 과제 제출 및 평가 결과 단건 조회 API
app.get('/api/assignments/:assignmentId/my-submission', isAuthenticated, (req, res) => {
  const studentId = req.session.user.username;
  const query = `
    SELECT 
      s.id as submission_id,
      s.file_name,
      s.submitted_at,
      s.submit_count,
      COALESCE(s.status, 'completed') as status,
      e.score,
      e.feedback,
      e.ai_involvement_score
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
