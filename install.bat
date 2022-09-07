@echo off

chcp 65001
powershell -Command "pm2 --version" && exit

echo "上述报错表明 pm2 尚未安装。尝试安装 pm2……"
regedit.exe /S %cd%\ps-policy.reg
npm i -g pm2 --registry=https://registry.npmmirror.com
echo "安装成功。"
pause
