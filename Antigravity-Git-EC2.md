현재 구성이라면 **GitHub를 중간 저장소로 사용하는 수동 배포 방식**으로 표준화하는 것이 가장 이해하기 쉽습니다.

전체 구조는 다음과 같습니다.

```text
[개발 PC]
VS Code
   │
   │ git add
   │ git commit
   │ git push
   ▼
[GitHub Repository]
   │
   │ git pull
   ▼
[AWS EC2]
   │
   │ pm2 restart
   ▼
[Node.js 서비스]
```

## 1. 로컬 개발 PC — 코드 수정

VS Code에서 코드를 수정하고 저장합니다.

예:

```text
server.js
routes/
public/
package.json
...
```

수정이 끝나면 **먼저 프로그램을 로컬에서 테스트**하는 것을 권장합니다.

---

## 2. 변경사항 확인

VS Code의 **Source Control**에서 변경 파일을 확인합니다.

또는 Terminal에서:

```bash
git status
```

예:

```text
modified: server.js
modified: public/index.html
```

`M`, `U` 등의 파일이 의도한 변경인지 확인합니다.

---

## 3. Stage

전체 변경사항을 올린다면:

```bash
git add .
```

특정 파일만 올린다면:

```bash
git add server.js
git add public/index.html
```

Stage된 내용을 확인하려면:

```bash
git status
```

---

## 4. Commit

변경 내용을 하나의 작업 단위로 기록합니다.

```bash
git commit -m "Update stock service"
```

Commit 메시지는 가능하면 **무엇을 변경했는지 알 수 있도록** 작성하는 것이 좋습니다.

예:

```bash
git commit -m "Add stock backtest API"
git commit -m "Fix stock data download"
git commit -m "Update frontend result table"
```

---

## 5. GitHub에 Push

```bash
git push
```

이제 GitHub Repository가 최신 상태가 됩니다.

```text
VS Code
   ↓
git add .
   ↓
git commit
   ↓
git push
   ↓
GitHub
```

---

# 6. EC2 접속

SSH로 EC2에 접속합니다.

Ubuntu라면 일반적으로:

```bash
ssh -i my-key.pem ubuntu@EC2_PUBLIC_IP
```

접속 후 프로젝트 디렉터리로 이동합니다.

```bash
cd ~/프로젝트디렉터리
```

예:

```bash
cd ~/stock-project
```

---

# 7. EC2에서 현재 상태 확인

바로 `git pull`하지 말고 먼저:

```bash
git status
```

정상적인 경우:

```text
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
```

이 상태라면 안전하게 업데이트할 수 있습니다.

---

# 8. GitHub에서 최신 코드 Pull

```bash
git pull
```

또는 명확하게:

```bash
git pull origin main
```

정상적으로 완료되면:

```text
Updating abc1234..def5678
Fast-forward
 server.js | ...
 ...
```

처럼 나타납니다.

이제 EC2의 소스코드가 GitHub와 동일해집니다.

---

# 9. package.json이 변경되었다면

Node.js 프로젝트에서는 이 부분이 중요합니다.

개발 PC에서 `package.json` 또는 `package-lock.json`을 변경했다면 EC2에서:

```bash
npm install
```

을 실행합니다.

운영 서버에서 `package-lock.json`을 기준으로 정확하게 설치하려면 일반적으로:

```bash
npm ci
```

를 사용하는 것이 더 적절합니다.

따라서 **의존성 변경이 없는 일반적인 코드 수정**이라면:

```text
git pull
```

만 하면 되고,

**package.json이 변경되었다면:**

```bash
git pull
npm ci
```

로 처리하는 것을 권장합니다.

---

# 10. PM2로 서비스 재시작

현재 `server.js`를 다음과 같이 실행하고 있으므로:

```bash
pm2 start server.js
```

코드를 업데이트한 후에는:

```bash
pm2 restart server
```

합니다.

먼저 현재 PM2 이름을 확인하려면:

```bash
pm2 list
```

예:

```text
┌────┬────────┬────────┬────────┐
│ id │ name   │ mode   │ status │
├────┼────────┼────────┼────────┤
│ 0  │ server │ fork   │ online │
└────┴────────┴────────┴────────┘
```

그러면:

```bash
pm2 restart server
```

입니다.

---

# 11. 서비스 정상 여부 확인

PM2 상태:

```bash
pm2 status
```

로그:

```bash
pm2 logs server
```

최근 로그만 보고 싶다면:

```bash
pm2 logs server --lines 50
```

그리고 실제 브라우저에서 서비스에 접속해서 정상적으로 동작하는지 확인합니다.

---

# 12. 전체 표준 절차

앞으로는 다음 절차를 **개발 → 배포의 표준 절차**로 사용하면 됩니다.

### 개발 PC

```bash
# ① VS Code에서 코드 수정

# ② 테스트

# ③ 변경사항 확인
git status

# ④ Stage
git add .

# ⑤ Commit
git commit -m "Update application"

# ⑥ GitHub에 Push
git push
```

### EC2

```bash
# ⑦ 프로젝트 디렉터리
cd ~/프로젝트디렉터리

# ⑧ 현재 상태 확인
git status

# ⑨ 최신 코드 가져오기
git pull

# ⑩ package.json 변경이 있는 경우
npm ci

# ⑪ PM2 재시작
pm2 restart server

# ⑫ 상태 확인
pm2 status

# ⑬ 오류 확인
pm2 logs server --lines 50
```

이를 하나의 흐름으로 보면:

```text
┌──────────────────────┐
│       VS Code        │
│      개발 PC          │
└──────────┬───────────┘
           │
           │ 코드 수정
           ↓
      git status
           │
           ↓
       git add .
           │
           ↓
   git commit -m "..."
           │
           ↓
        git push
           │
           ▼
┌──────────────────────┐
│        GitHub         │
│   최신 소스 저장소     │
└──────────┬───────────┘
           │
           │ git pull
           ↓
┌──────────────────────┐
│        AWS EC2        │
│                      │
│  git pull            │
│  npm ci (필요시)      │
│  pm2 restart server  │
└──────────┬───────────┘
           │
           ↓
      서비스 제공
```

## 13. 특히 중요한 4가지 원칙

### 원칙 1. EC2에서 소스코드를 직접 수정하지 않기

가능하면:

```text
개발 → VS Code
배포 → GitHub → EC2
```

로 일관되게 관리합니다.

EC2에서 직접 수정하면 나중에 `git pull` 시 충돌이 발생할 수 있습니다.

---

### 원칙 2. `git pull` 전에 항상 `git status`

```bash
git status
git pull
```

습관을 들이는 것이 좋습니다.

---

### 원칙 3. 코드 변경과 라이브러리 변경을 구분

일반적인 코드 수정:

```bash
git pull
pm2 restart server
```

`package.json` 변경:

```bash
git pull
npm ci
pm2 restart server
```

---

### 원칙 4. PM2 설정은 한 번만 제대로 해두기

앞서 설명한 것처럼 PM2의 자동 시작을 설정해 두는 것이 좋습니다.

```bash
pm2 save
pm2 startup
```

그리고 `pm2 startup`에서 출력되는 `sudo ...` 명령을 실행한 후:

```bash
pm2 save
```

까지 해두면 **EC2를 Stop → Start한 후에도 Node.js 서비스가 자동으로 올라오도록** 구성할 수 있습니다.

---

## 최종적으로는 이렇게 기억하면 됩니다

**개발할 때마다 PC에서:**

```bash
git add .
git commit -m "변경 내용"
git push
```

**배포할 때마다 EC2에서:**

```bash
git pull
pm2 restart server
```

**라이브러리가 변경되었다면:**

```bash
git pull
npm ci
pm2 restart server
```

이 정도가 현재 구성하신 **VS Code + GitHub + AWS EC2 + Node.js + PM2** 환경에서 가장 간단한 표준 수동 배포 절차입니다.
