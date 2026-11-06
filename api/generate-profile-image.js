const SUPABASE_BUCKET = 'profile-avatars';

function send(res, status, message, extra = {}) {
  res.status(status).json({ error: message, ...extra });
}

module.exports = async function generateProfileImage(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, 'POST 요청만 사용할 수 있습니다.');
  }

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !supabaseKey || !openaiKey) {
    return send(res, 503, '이미지 생성 서버 설정이 필요합니다.');
  }

  const authorization = req.headers.authorization || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return send(res, 401, '로그인 후 이용하세요.');
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (prompt.length < 10 || prompt.length > 500) return send(res, 400, '이미지 설명은 10~500자로 입력하세요.');

  const supabaseHeaders = { apikey: supabaseKey, authorization };
  try {
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: supabaseHeaders });
    if (!authResponse.ok) return send(res, 401, '로그인이 만료됐습니다. 다시 로그인하세요.');
    const authUser = await authResponse.json();
    if (!/^[0-9a-f-]{36}$/i.test(authUser.id || '')) return send(res, 401, '계정을 확인하지 못했습니다.');

    const claimResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_profile_avatar_generation`, {
      method: 'POST',
      headers: { ...supabaseHeaders, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!claimResponse.ok) return send(res, 503, 'Supabase 프로필 이미지 설정을 확인하세요.');
    if (await claimResponse.json() !== true) return send(res, 429, '1시간 뒤에 다시 생성할 수 있습니다.');

    const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: `Create a square avatar portrait for a dark fantasy tactical game. ${prompt}. One original character, face or upper body centered, striking silhouette, no text, no logos, no existing franchise characters.`,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        output_format: 'webp',
        output_compression: 80
      })
    });
    if (!imageResponse.ok) {
      const details = await imageResponse.json().catch(() => ({}));
      console.error('OpenAI image generation failed:', imageResponse.status, details.error?.code || 'unknown');
      return send(res, 502, '이미지를 생성하지 못했습니다. 잠시 후 다시 시도하세요.');
    }
    const imageData = await imageResponse.json();
    const encodedImage = imageData.data?.[0]?.b64_json;
    if (!encodedImage) return send(res, 502, '이미지 응답이 비어 있습니다.');
    const image = Buffer.from(encodedImage, 'base64');
    if (!image.length || image.length > 5 * 1024 * 1024) return send(res, 502, '생성된 이미지 크기를 처리할 수 없습니다.');

    const path = `${authUser.id}/avatar.webp`;
    const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/${SUPABASE_BUCKET}/${path}`, {
      method: 'POST',
      headers: { ...supabaseHeaders, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'cache-control': '3600' },
      body: image
    });
    if (!uploadResponse.ok) {
      console.error('Supabase avatar upload failed:', uploadResponse.status);
      return send(res, 502, '이미지를 저장하지 못했습니다. Storage 설정을 확인하세요.');
    }
    const updateResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${authUser.id}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ avatar_path: path })
    });
    if (!updateResponse.ok || !(await updateResponse.json()).length) {
      console.error('Supabase profile avatar update failed:', updateResponse.status);
      return send(res, 502, '프로필에 이미지를 연결하지 못했습니다.');
    }
    return res.status(200).json({ path, version: Date.now() });
  } catch (error) {
    console.error('Avatar generation request failed:', error);
    return send(res, 502, '이미지 생성 서버에 연결하지 못했습니다.');
  }
};
