# Supabase 설정

1. Supabase 프로젝트를 만든 뒤 SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.
2. Authentication의 Email provider 설정에서 Confirm email을 끕니다. 이 설정이면 가입 후 이메일 확인 없이 로그인할 수 있습니다.
3. Project Connect에서 Project URL과 publishable key를 복사해 `supabase-config.js`에 넣습니다. Secret/service role 키는 브라우저 코드에 넣지 않습니다.
4. `index.html`을 `file://`로 열지 말고 VS Code Live Server 같은 로컬 웹 서버로 실행합니다.

게임은 계정이 생명력을 모두 잃고 작전이 끝날 때 최고 도달 점수를 `game_records`에 저장합니다. 순위표는 사용자별 최고 점수 한 건을 보여줍니다. 점수 계산이 브라우저에서 진행되므로, 공개 서비스에서 부정 점수를 막으려면 서버에서 전투와 점수를 검증하는 Edge Function이 추가로 필요합니다.

## GPT Image 2 프로필 이미지

1. 기존 Supabase 프로젝트의 SQL Editor에서 업데이트된 `supabase/schema.sql` 전체를 다시 실행합니다. 프로필 컬럼, 공개 Storage 버킷, 소유자별 업로드 정책, 생성 간격 제한 함수가 추가됩니다.
2. Vercel 프로젝트 `lim`의 Settings → Environment Variables에 `OPENAI_API_KEY`(OpenAI API 키), `SUPABASE_URL`(프로젝트 URL), `SUPABASE_PUBLISHABLE_KEY`(브라우저 설정과 같은 publishable key)를 추가하고 Production에 적용합니다. OpenAI 키는 `supabase-config.js`나 Git에 넣지 마세요.
3. 환경 변수를 추가한 뒤 Vercel에서 다시 배포합니다. 로컬에서 서버 함수까지 확인하려면 `vercel dev`를 사용합니다. 단순 Live Server에서는 이미지 생성 API가 실행되지 않습니다.

로그인 후 상단 **프로필 이미지**에서 설명을 입력하고 생성합니다. 서버는 로그인 토큰을 Supabase에서 검증하고 `gpt-image-2`로 이미지를 만든 뒤 해당 계정의 Storage 경로에 저장합니다. 생성 요청은 계정당 1시간 간격이며 실패한 요청도 간격에 포함됩니다. OpenAI API 사용량에 따라 비용이 발생합니다. 이미지는 공개 프로필 및 순위표에 표시됩니다.
