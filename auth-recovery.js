/* Mi Viaje Asia: account password recovery only.
   Private encrypted-document passphrases remain local and CANNOT be reset. */
(()=>{
  const cfg=window.ASIA_TRIP_CONFIG||{};
  const API=cfg.supabaseUrl||'',KEY=cfg.supabaseKey||'';
  if(!/^https:\/\/[^/]+\.supabase\.co$/.test(API)||!KEY)return;
  const dialog=document.getElementById('app-dialog');
  const content=document.getElementById('dialog-content');
  const title=document.getElementById('dialog-title');
  if(!dialog||!content||!title)return;
  const source=new URL(location.href);
  const fragment=new URLSearchParams(source.hash.slice(1));
  let recoveryToken=fragment.get('type')==='recovery'?fragment.get('access_token'):null;
  if(recoveryToken){
    history.replaceState(history.state,'',location.pathname+location.search);
  }
  const api=async(url,body,auth)=>{
    const headers={'Content-Type':'application/json','apikey':KEY};
    if(auth)headers.Authorization='Bearer '+auth;
    const resp=await fetch(API+'/auth/v1/'+url,{method:auth?'PUT':'POST',headers,body:JSON.stringify(body)});
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok)throw Error(resp.status===429?'Demasiados intentos. Espera unos minutos.':data.msg||data.error_description||data.message||'Servicio de correo no disponible.');
    return data;
  };
  const status=(parent,text,isError=false)=>{
    const note=parent.querySelector('[data-recovery-status]');
    if(note){note.textContent=text;note.style.color=isError?'#a3314e':'#296958';}
  };
  function mountRecoveryLink(){
    const forms=[...content.querySelectorAll('form.form-grid')];
    for(const form of forms){
      const email=form.querySelector('input[name="email"]'),password=form.querySelector('input[name="password"]');
      if(!email||!password||form.dataset.recoveryReady)return;
      const submit=form.querySelector('button[type="submit"]');
      if(!submit||!/entrar/i.test(submit.textContent))continue;
      form.dataset.recoveryReady='true';
      const holder=document.createElement('div');
      holder.style.cssText='margin:8px 0 0;display:flex;flex-direction:column;gap:5px;';
      const link=document.createElement('button');
      link.type='button';link.textContent='¿Olvidaste tu contraseña?';
      link.setAttribute('data-password-recovery','');
      link.style.cssText='align-self:flex-start;appearance:none;border:0;border-radius:5px;background:none;padding:8px 2px;font:600 12.5px system-ui;color:#4b52a9;text-decoration:underline;text-underline-offset:3px;cursor:pointer;min-height:40px;';
      const note=document.createElement('span');
      note.setAttribute('data-recovery-status','');
      note.setAttribute('role','status');
      note.setAttribute('aria-live','polite');
      note.style.cssText='font-size:12px;line-height:1.45;';
      link.addEventListener('click',async()=>{
        const address=email.value.trim();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)){
          status(holder,'Escribe tu correo arriba para recuperar tu contraseña.',true);
          email.focus();return;
        }
        link.disabled=true;
        const label=link.textContent;link.textContent='Enviando enlace…';
        status(holder,'Solicitando instrucciones de recuperación…');
        try{
          const redirectTo=location.origin+location.pathname;
          await api('recover?redirect_to='+encodeURIComponent(redirectTo),{email:address});
          status(holder,'Solicitud enviada. Si ese correo está registrado, recibirás instrucciones. Revisa también spam.');
        }catch(err){status(holder,err.message||'No se pudo solicitar el correo.',true);}
        finally{link.disabled=false;link.textContent=label;}
      });
      holder.append(link,note);
      form.append(holder);
    }
  }
  const observer=new MutationObserver(mountRecoveryLink);
  observer.observe(content,{childList:true,subtree:true});
  mountRecoveryLink();
  if(!recoveryToken)return;
  function showReset(){
    if(dialog.open)dialog.close();
    document.getElementById('dialog-eyebrow').textContent='SEGURIDAD · ACCESO A TU CUENTA';
    title.textContent='Nueva contraseña';
    const form=document.createElement('form');form.setAttribute('data-password-reset-form','');
    form.style.cssText='display:grid;gap:12px;';
    const intro=document.createElement('p');intro.textContent='Escribe una contraseña nueva para recuperar tu cuenta. Tus documentos cifrados conservan sus propias claves privadas.';
    const label=document.createElement('label');label.textContent='Contraseña (10 caracteres o más)';label.setAttribute('for','recovery-new-password');
    const input=document.createElement('input');input.id='recovery-new-password';input.type='password';input.name='newPassword';input.required=true;input.minLength=10;input.maxLength=128;input.autocomplete='new-password';input.style.cssText='width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #777;';
    const btn=document.createElement('button');btn.type='submit';btn.textContent='Guardar contraseña';btn.style.cssText='min-height:44px;padding:11px 15px;border-radius:10px;border:0;background:#4b52a9;color:white;cursor:pointer;';
    const msg=document.createElement('p');msg.setAttribute('role','status');msg.setAttribute('aria-live','polite');msg.setAttribute('data-recovery-status','');
    form.append(intro,label,input,btn,msg);
    form.addEventListener('submit',async(e)=>{
      e.preventDefault();
      if(!recoveryToken)return;
      if(input.value.length<10){msg.textContent='La contraseña requiere al menos 10 caracteres.';return;}
      btn.disabled=true;msg.textContent='Guardando…';
      try{
        await api('user',{password:input.value},recoveryToken);
        recoveryToken=null;input.value='';msg.textContent='Contraseña cambiada. Puedes iniciar sesión con tu cuenta.';
        btn.remove();
      }catch(err){msg.textContent=err.message||'No se pudo cambiar la contraseña.';}
      finally{btn.disabled=false;}
    });
    content.replaceChildren(form);
    dialog.showModal();
    input.focus();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>queueMicrotask(showReset),{once:true});
  else queueMicrotask(showReset);
})();
