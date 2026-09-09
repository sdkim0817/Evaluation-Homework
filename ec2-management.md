
## 1. 현재 PM2 프로세스 저장

먼저 EC2에서:

```bash
pm2 list
```

`server`가 `online`인지 확인합니다.

그 다음:

```bash
pm2 save
```

이 명령은 현재 PM2에서 관리하고 있는 프로세스 목록을 저장합니다.

---

## 2. EC2 재부팅 시 PM2 자동 시작 설정

다음 명령을 실행합니다.

```bash
pm2 startup
```

그러면 다음과 비슷한 명령이 출력됩니다.

```text
sudo env PATH=$PATH:/home/ubuntu/.nvm/versions/node/vxx.x.x/bin \
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

**중요:** 화면에 출력된 `sudo ... pm2 startup ...` 명령을 그대로 복사해서 실행합니다.

그 다음 다시:

```bash
pm2 save
```

이제 구조가 다음과 같이 됩니다.

```text
EC2 Stop
   ↓
EC2 Start
   ↓
Linux 부팅
   ↓
systemd
   ↓
PM2 자동 시작
   ↓
server.js 자동 실행
   ↓
웹 서비스 정상 운영
```

---

## 3. 제대로 설정되었는지 확인

EC2를 실제로 재시작해 볼 수도 있습니다.

```bash
sudo reboot
```

SSH 연결이 끊어집니다.

잠시 기다린 후 다시 SSH 접속합니다.

```bash
ssh -i my-key.pem ubuntu@EC2_PUBLIC_IP
```

그리고:

```bash
pm2 list
```

다음처럼 `online`이면 성공입니다.

```text
┌────┬────────┬────────┬────────┐
│ id │ name   │ mode   │ status │
├────┼────────┼────────┼────────┤
│ 0  │ server │ fork   │ online │
└────┴────────┴────────┴────────┘
```

---

## 4. EC2를 Stop → Start하는 경우 IP도 확인

여기서 **한 가지 중요한 부분**이 있습니다.

EC2를 Stop했다가 Start하면 **Public IPv4 주소가 변경될 수 있습니다.**

따라서 다시 시작한 후 AWS EC2 콘솔에서 Public IPv4 주소를 확인해야 합니다.

예를 들어 기존에:

```text
http://3.10.20.30:3000
```

이었다가 EC2 재시작 후:

```text
http://54.100.200.50:3000
```

처럼 변경될 수 있습니다.

고정된 IP가 필요하다면 **Elastic IP**를 사용하는 것이 좋습니다.

---

## 5. 현재 프로젝트라면 이렇게 설정하는 것을 권장

현재 구조가:

```text
EC2
 ├── Node.js
 ├── server.js
 └── PM2
```

라면 다음을 한 번만 설정합니다.

```bash
pm2 start server.js
pm2 save
pm2 startup
```

`pm2 startup`에서 출력되는 `sudo ...` 명령 실행 후:

```bash
pm2 save
```

이후에는 EC2를 Stop/Start해도 `server.js`가 자동으로 실행됩니다.

그리고 **코드를 GitHub에서 업데이트할 때는**:

```bash
cd ~/프로젝트디렉터리
git pull
pm2 restart server
```

이면 됩니다.

### 최종적으로 기억할 명령 3개

```bash
pm2 save
```

→ 현재 실행 상태 저장

```bash
pm2 startup
```

→ EC2 부팅 시 PM2 자동 시작 설정

```bash
pm2 restart server
```

→ 코드 업데이트 후 서비스 재시작

```bash
cd ~/프로젝트디렉터리

git pull

pm2 restart server
```
