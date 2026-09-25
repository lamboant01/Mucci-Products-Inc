(function(){
  const core=window.MucciCards,list=document.querySelector("#saved-list"),config=window.MUCCI_CONFIG||{};
  const esc=(v)=>String(v||"").replace(/[&<>'"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const canonicalSiteUrl=String(config.publicSiteUrl||"https://mucciproducts.com").replace(/\/$/,"");
  function render(){
    const scans=core.getScans(localStorage).sort((a,b)=>String(b.lastViewedAt).localeCompare(String(a.lastViewedAt))),cache=core.getCache(localStorage);
    if(!scans.length){list.innerHTML=`<section class="empty-state"><h2>No saved cards yet</h2><p>Cards appear here after you open their private NFC link on this device.</p><a class="button button-primary" href="${canonicalSiteUrl}">Return home</a></section>`;return;}
    list.innerHTML=scans.map((scan)=>{const p=(cache[scan.publicToken]||{}).profile||{},image=p.profile_image_url||p.logo_url;return `<article class="saved-card" data-token="${esc(scan.publicToken)}">${image?`<img class="avatar-small" src="${esc(image)}" alt="">`:""}<h2>${esc(p.name||"Saved digital card")}</h2>${p.company?`<p>${esc(p.company)}</p>`:""}${p.title?`<p>${esc(p.title)}</p>`:""}<small>Last viewed ${new Date(scan.lastViewedAt).toLocaleString()}</small><div class="saved-card-actions"><a class="button button-primary" href="${canonicalSiteUrl}/card/${encodeURIComponent(scan.publicToken)}">Open card</a><button class="button button-secondary" data-remove="${esc(scan.publicToken)}">Remove</button></div></article>`}).join("");
    list.querySelectorAll("[data-remove]").forEach((button)=>button.addEventListener("click",()=>{core.removeScan(localStorage,button.dataset.remove);render();}));
    refresh(scans);
  }
  async function refresh(scans){
    if(!navigator.onLine||!config.supabaseUrl||!config.supabaseAnonKey)return;
    await Promise.allSettled(scans.map(async(scan)=>{const response=await fetch(`${config.supabaseUrl.replace(/\/$/,"")}/rest/v1/rpc/get_public_card_profile`,{method:"POST",headers:{apikey:config.supabaseAnonKey,Authorization:`Bearer ${config.supabaseAnonKey}`,"Content-Type":"application/json"},body:JSON.stringify({lookup_token:scan.publicToken})});if(!response.ok)return;const rows=await response.json(),profile=Array.isArray(rows)?rows[0]:rows;if(profile)core.cachePublicProfile(localStorage,scan.publicToken,profile);}));
  }
  render();
})();
