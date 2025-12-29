# Git 커밋 메시지 인코딩 수정 스크립트
$ErrorActionPreference = "Stop"

# UTF-8 인코딩 설정
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

# Git 설정
git config --global core.quotepath false
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8

Write-Host "Git 인코딩 설정이 완료되었습니다." -ForegroundColor Green
Write-Host ""
Write-Host "이제 다음 명령어로 커밋 메시지를 확인하세요:" -ForegroundColor Yellow
Write-Host "  git log --oneline -5" -ForegroundColor Cyan




