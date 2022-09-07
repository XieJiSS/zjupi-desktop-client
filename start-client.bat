@echo off

powershell -Command "pm2 stop client"
powershell -Command "pm2 start client.js"
powershell -Command "pm2 save"
