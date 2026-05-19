# TinyIDS Project

TinyIDS เป็นระบบตรวจจับและแสดงผลเหตุการณ์เครือข่ายสำหรับงาน IoT โดยประกอบด้วย:

- `frontend/` สำหรับหน้าเว็บ React + Vite
- `backend/` สำหรับ Flask API, Socket.IO และ MQTT ingestion
- `db` สำหรับ MySQL
- MQTT broker ภายนอกที่กำหนดผ่านไฟล์ `.env`


## สิ่งที่ต้องมี

- Docker Desktop
- Git
- Node.js 20 ขึ้นไป ถ้าต้องการรัน frontend แบบ local
- Python 3.11 ขึ้นไป ถ้าต้องการรัน backend แบบ local

## Clone โปรเจกต์

```bash
git clone https://github.com/Ninepulin9/TinyIDS_Project.git
cd TinyIDS_Project
```

## ตั้งค่า Environment

สร้างหรือแก้ไขไฟล์ `.env` ที่ root ของโปรเจกต์

```env
MQTT_BROKER_URL=your-mqtt-host
MQTT_BROKER_PORT=8883
MQTT_USERNAME=your-username
MQTT_PASSWORD=your-password
```

ถ้าจะรัน local โดยไม่ใช้ MQTT ชั่วคราว สามารถปล่อย `MQTT_BROKER_URL` ว่างได้ โดยระบบ backend จะข้ามการเชื่อมต่อ broker

## รันด้วย Docker Compose

```bash
docker compose up --build
```

หลังระบบเริ่มทำงาน:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5000`
- Health check: `http://localhost:5000/health`

-----------------------------------------------------------------------
"ใช้เฉพาะตอนรัน backend local"
ตั้งค่า `DATABASE_URL` ให้ชี้ไปยัง MySQL ที่ใช้งานได้ เช่น
```env
DATABASE_URL=mysql+pymysql://tinyids:tinyids@localhost:3306/tinyids
```
-----------------------------------------------------------------------


## โครงสร้างโปรเจกต์

```text
TinyIDS_Project/
+-- backend/             # Flask API, Socket.IO, MQTT service
+-- frontend/            # React + Vite frontend
+-- scripts/             # utility scripts
+-- mosquitto/           # optional legacy assets for self-hosted MQTT/TLS
+-- docker-compose.yml
+-- discovery_client.py  # helper สำหรับ discovery ผ่าน MQTT
+-- .env
```

