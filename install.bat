@echo off

powershell -Command "echo Unrestricted" || regedit.exe /S %cd%\ps-policy.reg
powershell -Command "pm2 --version" || goto install
exit

:install
echo "上述报错表明 pm2 尚未安装。尝试安装 pm2……"
npm i -g pm2 --registry=https://registry.npmmirror.com
echo "安装成功。"
pause
