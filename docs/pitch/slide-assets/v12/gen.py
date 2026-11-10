import os
S=os.path.dirname(os.path.abspath(__file__))
def page(no, section, body):
    return f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="base.css"><script src="brands.js"></script></head><body>
<div class="bg"><i></i><i></i><i></i></div>
<div class="hd"><b>IDEA AUDITION</b> — {section}</div><div class="ln"></div><div class="no">{no:02d}</div>
{body}</body></html>'''
slides={}
slides[6]=('THE REVEAL','''
<div style="position:absolute;left:60px;top:250px;width:540px">
<h1 style="font-size:72px">その答えが、<br><em style="font-size:74px">IDEA<br>AUDITION。</em></h1>
<p class="sub" style="margin-top:28px;font-size:26px">AIが挑戦する。<br>人間が、全員一致で選ぶ。</p>
</div>
<div class="frame" style="position:absolute;right:50px;top:170px;width:1040px;transform:perspective(1600px) rotateY(-8deg)"><img src="02-buzz-2of4.png"></div>
''')
def tile(img,n,label,desc):
    return f'''<div style="display:flex;gap:22px;align-items:center"><div class="frame" style="width:470px;flex:none"><img src="{img}"></div>
<div style="display:grid;gap:12px"><div style="display:flex;align-items:center;gap:12px;font-size:28px;font-weight:900"><span class="num">{n}</span>{label}</div>
<div style="font-size:19px;color:#cdb8e8;line-height:1.6">{desc}</div></div></div>'''
slides[7]=('LIVE DEMO',f'''
<h1 style="position:absolute;left:60px;top:118px;font-size:62px">AIがプレゼン。<em>人間が選ぶ。</em></h1>
<div style="position:absolute;left:60px;right:60px;top:230px;bottom:50px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:26px 40px;align-items:center">
{tile('02-buzz-2of4.png',1,'1人ずつ登場','審査員それぞれが自分のブザーを押す')}
{tile('03-pass.png',2,'全員一致で合格','4/4 で合格。合格者待機室へ')}
{tile('06-spotlight.png',3,'決勝で深掘り','タップした1人にスポットライト。質問・改善')}
{tile('07-champion.png',4,'優勝と企画書','決まった瞬間に企画書PDF')}
</div>''')
slides[8]=('HOW IT WORKS','''
<h1 style="position:absolute;left:60px;top:118px;font-size:62px">話すほど、<em>案が変わる。</em></h1>
<div class="frame" style="position:absolute;left:60px;top:250px;width:860px"><img src="01-deepdive.png"></div>
<div style="position:absolute;left:960px;right:60px;top:250px;display:grid;gap:22px">
<div class="card" style="padding:22px 26px"><div style="display:flex;gap:12px;align-items:center;font-size:26px;font-weight:900"><span class="num">1</span>深掘りタイム</div><p class="sub" style="font-size:19px;margin-top:8px">気になったら質問。話している間は交代のカウントが止まる</p></div>
<div class="card" style="padding:22px 26px"><div style="display:flex;gap:12px;align-items:center;font-size:26px;font-weight:900"><span class="num">2</span>会話が「合意」になる</div><p class="sub" style="font-size:19px;margin-top:8px">「導入コストは低く抑えるべきだ」「毎日継続して遊べる仕組みにする」を Gemini が論点にして、賛成した人を記録</p></div>
<div class="card" style="padding:22px 26px;border-color:#ff72ed"><div style="display:flex;gap:12px;align-items:center;font-size:26px;font-weight:900"><span class="num">3</span>次の案と改良に反映</div><p class="sub" style="font-size:19px;margin-top:8px">合意が動いたら古い作り置きを捨て、新しい条件で作り直す</p></div>
</div>''')
slides[9]=('THE ENGINEERING','''
<h1 style="position:absolute;left:60px;top:130px;font-size:80px">人間が複数。<br><em>AIも複数。</em></h1>
<p class="sub" style="position:absolute;left:64px;top:370px;font-size:28px">しかも、全員が同時には動かない。</p>
<svg style="position:absolute;right:60px;top:150px" width="820" height="700" viewBox="0 0 820 700">
<defs><marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#FF72ED"/></marker></defs>
<ellipse cx="410" cy="380" rx="170" ry="60" fill="#3a1660" stroke="#df8dff" stroke-width="3" style="filter:drop-shadow(0 0 18px #b14cff)"/>
<text x="410" y="390" text-anchor="middle" font-size="26" font-weight="900" fill="#fff">1つの舞台</text>
''' + ''.join(f'<g><circle cx="{x}" cy="90" r="46" fill="#22143a" stroke="{c}" stroke-width="3"/><text x="{x}" y="100" text-anchor="middle" font-size="30" font-weight="900" fill="{c}">{l}</text><path d="M{x} 140 L{410+(x-410)*0.35} 318" stroke="#FF72ED" stroke-width="3" marker-end="url(#m)" stroke-dasharray="{d}"/></g>' for x,c,l,d in [(110,'#ff7ad9','A',''),(310,'#58c8ff','B','8 6'),(510,'#ffc04d','C',''),(710,'#7ef0c0','D','3 6')]) + ''.join(f'<g><rect x="{x-80}" y="560" width="160" height="80" rx="18" fill="#22143a" stroke="#c97cfa" stroke-width="2"/><text x="{x}" y="610" text-anchor="middle" font-size="22" font-weight="800" fill="#e9dcff">{l}</text><path d="M{x} 556 L{410+(x-410)*0.4} 448" stroke="#C97CFA" stroke-width="3" marker-end="url(#m)" stroke-dasharray="{d}"/></g>' for x,l,d in [(180,'Gemini 生成','4 6'),(410,'Gemini 改良',''),(640,'Gemini 回答','10 6')]) + '''
<text x="410" y="240" text-anchor="middle" font-size="20" fill="#cdb8e8">同時に押す・通信が切れる・AIの結果が遅れて届く</text>
</svg>''')
slides[10]=('SYSTEM ARCHITECTURE','''
<h1 style="position:absolute;left:60px;top:112px;font-size:52px">人間の判断が、<em>AIの次の一手</em>になる。</h1>
<div class="card" style="position:absolute;left:60px;right:60px;top:210px;bottom:50px;padding:14px;display:flex;align-items:center;justify-content:center"><img src="arch3.png" style="max-width:100%;max-height:100%"></div>''')
def g(icon,name,use,why):
    return f'''<div class="card" style="padding:30px 30px;display:flex;flex-direction:column;gap:16px">
<div style="display:flex;align-items:center;gap:14px">{icon}<span style="font-size:30px;font-weight:900">{name}</span></div>
<div style="font-size:22px;color:#ffd3f6;font-weight:800">{use}</div><div style="font-size:19px;color:#cdb8e8;line-height:1.7">{why}</div></div>'''
gem='<svg viewBox="0 0 24 24" width="40" height="40"><path fill="#8E75B2" id="gp"/></svg>'
def row(name,use,why):
    return f'''<div style="display:grid;grid-template-columns:28px 1fr;gap:8px 12px;padding:16px 0;flex:1;align-content:center;border-top:1px solid #4a2c70">
<svg viewBox="0 0 24 24" width="26" height="26" style="grid-row:span 2"><path class="gp" fill="#B79CFF"/></svg>
<div style="font-size:27px;font-weight:900">{name}<span style="font-size:20px;color:#ffd3f6;font-weight:800;margin-left:14px">{use}</span></div>
<div style="font-size:18px;color:#cdb8e8;line-height:1.6">{why}</div></div>'''
def gc(icon,name,use,why):
    return f'''<div class="card" style="padding:26px 26px;display:flex;flex-direction:column;justify-content:center;gap:14px">
<div style="display:flex;align-items:center;gap:12px">{icon}<span style="font-size:28px;font-weight:900">{name}</span></div>
<div style="font-size:21px;color:#ffd3f6;font-weight:800">{use}</div><div style="font-size:17px;color:#cdb8e8;line-height:1.7">{why}</div></div>'''
slides[11]=('GOOGLE CLOUD',f'''
<h1 style="position:absolute;left:60px;top:112px;font-size:54px">Google の技術で、<em>最後までつくる。</em></h1>
<div class="card" style="position:absolute;left:60px;top:215px;bottom:55px;width:790px;padding:22px 30px;display:flex;flex-direction:column">
<div style="display:flex;align-items:center;gap:14px;margin-bottom:6px"><img src="vertexai.svg" width="40"><span style="font-size:30px;font-weight:900">Vertex AI × Gemini</span><span style="font-size:17px;color:#cdb8e8;margin-left:auto">AI は Gemini だけ</span></div>
{row('Gemini 3.5 Flash','案・回答・合意・発言の仕分け','審査のテンポを止めない速さ。雑談は捨て、審査の話だけを言い直して使う')}
{row('Gemini 3.8 Flash','改良・批評・企画書','質が要るところだけ上位モデル。優勝が決まる前から企画書を作り置き')}
{row('Gemini Live','声の文字起こし・声の調子','会議の語彙で聞き取り、声の温度感も文脈に入れる')}
{row('Gemini Embedding','似た案を出さない','合格した案とほぼ同じ案を除き、審査員の好みとの近さを測る')}
</div>
<div style="position:absolute;left:880px;right:60px;top:215px;bottom:55px;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:20px">
{gc('<img src="cloudrun.svg" width="36">','Cloud Run','1部屋＝1つの順番','WebSocket を受け、操作を1件ずつ確定。画面とサーバーを1つのコンテナで配信')}
{gc('<img src="firestore.svg" width="36">','Firestore','審査の記録を保存','確定したイベントと状態を保存。サーバーが替わっても途中から戻れる')}
{gc('<svg viewBox="0 0 24 24" width="36" height="36"><path id="wr" fill="#7ef0c0"/></svg>','Google STUN','4人の音声通話','ブラウザ同士を直接つなぐための接続先探し')}
{gc('<svg viewBox="0 0 24 24" width="36" height="36"><path d="M12 2l8.66 5v10L12 22l-8.66-5V7z" fill="none" stroke="#58c8ff" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#58c8ff"/></svg>','Cloud Build','コンテナを作って配る','Artifact Registry に保管して、Cloud Run へそのまま出す')}
</div>
<script>document.querySelectorAll('.gp').forEach(p=>p.setAttribute('d',BRANDS.googlegemini));document.getElementById('wr').setAttribute('d',BRANDS.webrtc)</script>''')
slides[12]=('THE PROTOCOL','''
<div style="position:absolute;left:60px;top:118px;display:flex;align-items:center;gap:26px">
<img src="camp-logo.png" style="width:120px;border-radius:24px;box-shadow:0 0 30px #b250ff88">
<h1 style="font-size:56px">だから、独自プロトコル <em>CAMP</em> を作った。</h1></div>
<p class="sub" style="position:absolute;left:66px;top:262px;font-size:20px">Collaborative Agent Mediation Protocol — 人の同時操作と、遅れて届く AI の結果を、1つの順番に調停する</p>
<div class="card" style="position:absolute;left:60px;right:60px;top:320px;bottom:50px;padding:14px;display:flex;align-items:center;justify-content:center"><img src="camp.png" style="max-width:100%;max-height:100%"></div>''')
slides[13]=('OPEN SOURCE','''
<h1 style="position:absolute;left:60px;top:118px;font-size:62px">作って、終わりじゃない。<br><em>CAMPをOSSとして公開。</em></h1>
<div class="frame" style="position:absolute;left:60px;top:330px;width:900px;bottom:50px"><img src="github_readme.png"></div>
<div style="position:absolute;left:1000px;right:60px;top:330px;display:grid;gap:16px">
<div class="card" style="padding:20px 24px;font-size:22px;font-weight:800;color:#ff9bf0">github.com/camp-protocol/camp</div>
''' + ''.join(f'<div class="card" style="padding:16px 24px;font-size:20px">✓ {t}</div>' for t in ['仕様書 SPEC.md（英語）','適合テスト・CI（Node 20 / 22 / 24）','client と server を1つのパッケージで','MIT ライセンス']) + '''
<div class="card" style="padding:18px 24px;font-family:Menlo,monospace;font-size:20px;color:#7ef0c0;background:#06110c">$ npm install @camp-protocol/kit</div>
</div>''')
def stat(big,unit,label,note):
    return f'''<div class="card" style="padding:26px 28px;display:grid;gap:6px"><div style="font-size:64px;font-weight:900;color:#ffd76b;text-shadow:0 0 18px #ffb40088">{big}<span style="font-size:26px;color:#ffe9b0"> {unit}</span></div><div style="font-size:22px;font-weight:800">{label}</div><div style="font-size:15px;color:#b9a8d0">{note}</div></div>'''
slides[14]=('PROOF',f'''
<h1 style="position:absolute;left:60px;top:118px;font-size:60px">本当に、<em>作る意味があったのか。</em></h1>
<div style="position:absolute;left:60px;right:60px;top:250px;display:grid;grid-template-columns:repeat(3,1fr);gap:22px">
{stat('0','秒','優勝から企画書が出るまで','以前は本番で 11〜13 秒 → 決勝の間に作り置き')}
{stat('198','件','自動テスト（すべて合格）','4人同時のブザーでも合格は1回・再送は二重に実行しない など')}
{stat('5 → 1','人','予選で同時に見る案','5人並びで見るものが多すぎる → 1人ずつ登場')}
</div>
<div class="card" style="position:absolute;left:60px;right:60px;top:560px;padding:24px 30px">
<div style="font-size:22px;font-weight:900;margin-bottom:12px">使ってもらって、直したこと</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 40px;font-size:18px;color:#e3d3f5">
<span>✓ 5人並びで見るものが多すぎる → 1人ずつ登場</span><span>✓ 改良で旧版の条件が残る → 版ごとに中身を持つ</span>
<span>✓ 15秒では発言が間に合わない → 持ち時間を選べる・一時停止</span><span>✓ 同じ質問が2回出る → 二重送信を防止</span>
<span>✓ 企画書が出るまで待つ → 作り置きで 0 秒</span><span>✓ 回線によって声が届かない → 中継（TURN）でつなぐ</span>
</div></div>''')
slides[15]=('THE MESSAGE','''
<img src="logo.webp" style="position:absolute;right:60px;top:170px;width:700px;filter:drop-shadow(0 0 24px #b250ffaa)">
<div style="position:absolute;left:60px;top:170px">
<h1 style="font-size:70px;line-height:1.35">AIが、考える。<br><em>人間が、選ぶ。</em><br><span style="font-size:52px">そして、アイデアが進化する。</span></h1>
</div>
<div style="position:absolute;left:60px;right:60px;bottom:90px;text-align:center">
<div style="display:inline-block;font-size:34px;font-weight:900;letter-spacing:2px;padding:20px 44px;border-radius:999px;border:2px solid #FF72ED;box-shadow:0 0 30px #ff72ed66;background:#1a0a2acc">Own the Why — 選んだ理由まで、人間のものに。</div>
</div>''')
slides={(k+1 if k>=7 else k):v for k,v in slides.items()}
slides[7]=('DEMO VIDEO','''
<div class="frame" style="position:absolute;left:150px;right:150px;top:130px;bottom:70px;display:flex;align-items:center;justify-content:center">
<img src="02-buzz-2of4.png" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(6px) brightness(.35)">
<div style="position:relative;text-align:center;display:grid;gap:22px;justify-items:center">
<div style="width:150px;height:150px;border-radius:50%;border:4px solid #FF72ED;display:flex;align-items:center;justify-content:center;box-shadow:0 0 40px #ff72ed99;background:#1a0a2acc">
<svg width="64" height="64" viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="#FF72ED"/></svg></div>
<div style="font-size:44px;font-weight:900;font-style:italic">DEMO：4人で審査する</div>
<div style="font-size:22px;color:#cdb8e8">ここに動画（約90秒）</div>
</div></div>''')

def trow(name,good,lack,hl=False):
    bg='background:linear-gradient(90deg,#3a1660,#22123a);border:2px solid #FF72ED;box-shadow:0 0 24px #ff72ed55' if hl else 'background:#1a0f2acc;border:1.5px solid #4a2c70'
    c='#FF72ED' if hl else '#F8F3FF'
    return f'''<div style="display:grid;grid-template-columns:330px 380px 1fr;gap:28px;align-items:center;padding:22px 30px;border-radius:16px;{bg}">
<div style="font-size:26px;font-weight:900;color:{c}">{name}</div><div style="font-size:19px;color:#e3d3f5;line-height:1.55">{good}</div><div style="font-size:19px;color:{'#fff' if hl else '#cdb8e8'};line-height:1.55">{lack}</div></div>'''
slides={(k+1 if k>=14 else k):v for k,v in slides.items()}
slides[14]=('WHY NOT EXISTING',f'''
<h1 style="position:absolute;left:60px;top:112px;font-size:56px">なぜ、<em>既存の仕組みではダメなのか。</em></h1>
<div style="position:absolute;left:60px;right:60px;top:212px;font-size:26px;font-weight:800;padding:16px 26px;border-left:6px solid #FF72ED;background:#1a0a2acc">人の操作と、遅れて届く AI の結果を、<span style="color:#FF72ED">同じ順番で確定させる仕組み</span>が無い。</div>
<div style="position:absolute;left:60px;right:60px;top:318px;display:grid;gap:14px">
<div style="display:grid;grid-template-columns:330px 380px 1fr;gap:28px;padding:0 32px;font-size:17px;color:#b9a8d0;letter-spacing:2px"><span>仕組み</span><span>得意なこと</span><span>IDEA AUDITION で足りないこと</span></div>
{trow('Socket.IO','メッセージを速く届ける','届けるだけ。どれを先に確定するか、再送を1回にするか、古い AI の結果を捨てるかは全部自前')}
{trow('Firebase','データを全員に同期する','「4票目で合格を1回だけ」「遅れて届いた AI の結果は古い」を判断する場所が無い')}
{trow('Liveblocks / Yjs','共同編集（みんなの編集を混ぜる）','混ぜるのが前提。合格・優勝のように「1つに決める」判断に向かない')}
{trow('CAMP','人の操作も AI の結果も、1つの順番で確定','再送しても実行は1回（commandId）。古い AI の結果は捨てる（epoch）。断るときは理由つき',True)}
</div>''')
for no,(sec,body) in sorted(slides.items()):
    open(os.path.join(S,f's{no:02d}.html'),'w').write(page(no,sec,body))
print(sorted(slides))
