

요청하신 조건을 반영하면 **시스템 부하가 매우 낮은 가벼운 환경**입니다.

- **제출 파일:** HTML, CSS, JS, MD, 소형 PDF (개별 파일 **1MB 이하**)
- **사용자 규모:** **100명 이내**
- **트래픽 특성:** 순간 폭주 가능성 매우 낮음

이 환경에서는 AWS의 **가장 저렴한 인스턴스로도 차고 넘치는 성능**을 내며, 비용도 월 1만 원 이하(약 $4~$7/월)로 극대화하여 절감할 수 있습니다.

요구사항에 최적화된 **EC2 실전 배포 계획서**를 작성해 드립니다.



# 📋 EC2 기반 과제 자동 평가 서비스 배포 계획서

## 1. 인프라 스펙 및 예상 비용

| **구분**      | **선택 스펙**                             | **사유 / 설명**                                              |
| ------------- | ----------------------------------------- | ------------------------------------------------------------ |
| **인스턴스**  | **`t4g.micro`** (2 vCPU, 1GB RAM)         | 100명 이내 & 1MB 이하 파일 처리에 최적화된 ARM 기반 가성비 인스턴스 |
| **OS**        | **Ubuntu 24.04 LTS (ARM64)**              | 가장 대중적이며 최신 보안 패치 및 Node.js 지원               |
| **스토리지**  | **EBS gp3 10GB~20GB**                     | 100명 x 과제 여러 건 제출을 감안해도 10~20GB면 충분          |
| **예상 비용** | **월 약 $5 ~ $7** (원화 약 7,000~9,000원) | AWS 프리티어 대상일 경우 첫 1년은 거의 무료 사용 가능        |

## 2. 전체 아키텍처 구성

```
[학생/사용자 Browser]
       │
       ▼ (HTTPS / 443 포트)
[EC2 (t4g.micro)]
   ├── Nginx (Reverse Proxy & Let's Encrypt SSL)
   │     │ (Localhost 3000 포트)
   │     ▼
   └── Node.js Express App (PM2 관리)
         ├── SQLite DB 파일 (`database.db`)  ──┐ (EBS 디스크에 저장되어
         └── 업로드 폴더 (`uploads/`)        ──┴─  재시작 시에도 100% 보존)
```

## 3. 단계별 배포 실행 계획 (Step-by-step)



**1.EC2 인스턴스 생성 및 보안 그룹 설정:**소요 시간: ~5분.

1. AWS Console에서 EC2 인스턴스 생성: **`t4g.micro`** (Ubuntu 24.04 LTS ARM) 선택.
2. **EBS 용량:** 15GB (gp3) 할당.
3. **보안 그룹(Security Group) 인바운드 규칙 추가:**
   - `22` (SSH) — 내 IP 허용
   - `80` (HTTP) — 위치 지정 없음 (`0.0.0.0/0`)
   - `443` (HTTPS) — 위치 지정 없음 (`0.0.0.0/0`)

**2.서버 기본 환경 구축 (Node.js & PM2):**소요 시간: ~10분.

SSH로 EC2에 접속 후 필요한 패키지를 설치합니다.

Bash

```
# 패키지 업데이트 및 Node.js (v20+) 설치
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx

# 프로세스 관리자 PM2 글로벌 설치
sudo npm install -g pm2
```

**3.소스코드 배포 및 애플리케이션 실행:**소요 시간: ~10분.

1. Git을 통해 프로젝트 코드를 `/var/www/assignment-app` 경로로 가져옵니다.
2. 프로젝트 폴더 생성 후 `uploads/` 폴더 권한을 확인합니다.
3. PM2로 애플리케이션을 실행하고 **서버 재부팅 시 자동 실행**되도록 등록합니다.

Bash

```
cd /var/www/assignment-app
npm install --production

# PM2로 앱 시작
pm2 start npm --name "assignment-eval" -- start

# EC2 재부팅 시에도 PM2가 자동으로 앱을 띄우도록 설정
pm2 save
pm2 startup
```

**4.Nginx 리버스 프록시 및 SSL(HTTPS) 적용:**소요 시간: ~10분.

1. Nginx 설정 파일(`/etc/nginx/sites-available/default`)에 3000번 포트 연결을 추가합니다.
   - 파일 업로드 용량을 고려해 `client_max_body_size 10M;` 구문을 포함합니다.
2. **Certbot**을 이용해 Let's Encrypt 무료 SSL 인증서를 발급받고 HTTPS를 적용합니다.

Bash

```
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d [서비스_도메인_이름]
```



## 4. 데이터 보존 및 안정성 확보를 위한 핵심 설정 2가지

### 1) 1GB RAM 메모리 부족 방지 (Swap Memory 할당)

`t4g.micro`는 RAM이 1GB입니다. 아주 드물게 평가 실행 중 메모리가 튈 때 서버가 멈추는 것을 방지하기 위해 1GB~2GB 가상 메모리(Swap)를 잡아야 합니다.

Bash

```
# 2GB 스왑 파일 생성 및 활성화
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 재부팅 시에도 스왑 유지되도록 설정
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 2) SQLite 및 업로드 파일 간단 백업 (Cron)

EBS 디스크 자체로 데이터가 보존되지만, 과제 데이터의 안전을 위해 매일 새벽 DB 파일과 과제 폴더를 압축하는 로컬 백업 스크립트를 걸어둡니다.

Bash

```
# crontab -e 명령어로 매일 새벽 3시 백업 등록
0 3 * * * tar -czf /home/ubuntu/backups/backup_$(date +\%Y\%m\%d).tar.gz /var/www/assignment-app/database.db /var/www/assignment-app/uploads
```

## 🎯 요약

이 계획대로 진행하시면 **월 1만 원 이하의 비용**으로 100명 이내 학생들의 과제 제출 및 자동 평가 서비스를 매우 안정적으로 운영할 수 있으며, EC2나 Node.js가 재시작되어도 **SQLite 데이터 및 제출 파일은 100% 안전하게 유지**됩니다.



---



앞서 수립한 **`t4g.micro` EC2 + Express + SQLite3** 환경에 바로 적용할 수 있는 Nginx 설정과 배포 자동화 쉘 스크립트입니다.

## 1. Nginx 설정 파일 (`/etc/nginx/sites-available/assignment-app`)

과제 제출 시 파일 용량 제한(`client_max_body_size`)과 reverse proxy 설정을 포함한 기본 Nginx 설정입니다.

Nginx

```
# Express 앱으로 전달할 upstream 설정
upstream node_app {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com; # 본인의 도메인 또는 EC2 퍼블릭 IP 작성

    # 과제 업로드 용량이 1MB 이하이므로 10MB 정도의 안전 폭 설정
    client_max_body_size 10M;

    # Gzip 압축 설정 (HTML, CSS, JS, MD 파일 응답 속도 향상)
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/markdown;

    location / {
        proxy_pass http://node_app;
        
        # HTTP/1.1 사용 및 커넥션 헤더 유지
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        
        # 실사용자 IP 전달 설정
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 제한 시간 설정 (과제 평가 시 시간 소요 고려)
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 정적 파일이나 업로드 경로에 대한 Nginx 단에서의 보안/에러 처리가 필요할 경우 확장 가능
}
```

> **적용 및 SSL 발급 방법:**
>
> 1. 위 내용을 파일로 저장 후 활성화: `sudo ln -s /etc/nginx/sites-available/assignment-app /etc/nginx/sites-enabled/`
> 2. SSL(HTTPS) 적용: `sudo certbot --nginx -d your-domain.com` (Certbot 실행 시 SSL 구문이 파일 하단에 자동으로 추가됩니다.)

## 2. 한 번에 배포하는 쉘 스크립트 (`deploy.sh`)

Git에서 코드를 받아오고, 패키지를 설치하며, PM2 프로세스를 재시작하는 배포 전용 스크립트입니다.

프로젝트 루트 폴더(예: `/var/www/assignment-app`)에 저장 후 사용할 수 있습니다.

Bash

```
#!/bin/bash

# 에러 발생 시 스크립트 실행 중단
set -e

APP_DIR="/var/www/assignment-app"
APP_NAME="assignment-eval"

echo "🚀 [1/5] 배포 프로세스를 시작합니다..."
cd $APP_DIR

echo "📥 [2/5] Git 최신 소스코드 동기화..."
git pull origin main

echo "📦 [3/5] Node.js 의존성 패키지 설치..."
npm ci --only=production

echo "📁 [4/5] 필수 디렉터리 및 데이터 파일 점검..."
# uploads 폴더 및 database.db 파일이 존재하는지 확인 후 없으면 생성
if [ ! -d "uploads" ]; then
  mkdir -p uploads
  echo "  └─ uploads/ 폴더 생성 완료"
fi

echo "🔄 [5/5] PM2 프로세스 재시작..."
# PM2 실행 여부 확인 후 리로드 또는 새로 실행
if pm2 list | grep -q "$APP_NAME"; then
  pm2 reload $APP_NAME --update-env
  echo "  └─ 기존 PM2 프로세스 무중단 Reload 완료"
else
  pm2 start npm --name "$APP_NAME" -- start
  pm2 save
  echo "  └─ 신규 PM2 프로세스 등록 완료"
fi

echo "✅ 배포가 성공적으로 완료되었습니다!"
```

### 💡 스크립트 실행 방법

Bash

```
# 실행 권한 부여
chmod +x deploy.sh

# 배포 실행
./deploy.sh
```

