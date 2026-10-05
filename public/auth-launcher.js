const attach=()=>{
  const actions=document.querySelector('.actions');
  if(!actions||actions.querySelector('[data-live-launcher]')) return;
  const link=document.createElement('a');
  link.href='/live.html';
  link.className='btn';
  link.dataset.liveLauncher='true';
  link.textContent='Open live workspace';
  actions.appendChild(link);
};
new MutationObserver(attach).observe(document.body,{childList:true,subtree:true});
attach();
