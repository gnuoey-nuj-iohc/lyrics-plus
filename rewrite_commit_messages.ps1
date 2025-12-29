# Git 커밋 메시지 재작성 스크립트
$ErrorActionPreference = "Stop"

# UTF-8 인코딩 설정
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

cd "c:\Users\cjun0\AppData\Local\spicetify\CustomApps\lyrics-plus"

# 커밋 메시지 매핑 (해시 -> 올바른 메시지)
$commitMessages = @{
    "39cac78" = "번역 프롬프트 개선: 더 자연스러운 한국어 번역을 위한 가이드라인 추가"
    "33c1bb6" = "번역 프롬프트 개선: 더 자연스러운 한국어 번역을 위한 가이드라인 추가"
    "c489185" = "번역 프롬프트 개선: 더 자연스러운 한국어 번역을 위한 가이드라인 추가"
}

Write-Host "커밋 메시지를 수정합니다..." -ForegroundColor Yellow

# git filter-branch를 사용하여 커밋 메시지 수정
# 하지만 더 안전한 방법은 interactive rebase를 사용하는 것입니다
Write-Host ""
Write-Host "다음 명령어를 사용하여 커밋 메시지를 수정할 수 있습니다:" -ForegroundColor Cyan
Write-Host "  git rebase -i HEAD~2" -ForegroundColor Yellow
Write-Host ""
Write-Host "또는 개별적으로 수정하려면:" -ForegroundColor Cyan
Write-Host "  git commit --amend -m '올바른 메시지'" -ForegroundColor Yellow




