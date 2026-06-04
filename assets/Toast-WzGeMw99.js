function o(a,n="success"){const s=document.getElementById("toast-container");if(!s)return;const t=document.createElement("div");t.className=`
    min-w-[250px] px-4 py-3 rounded-lg shadow-xl text-white transform translate-y-10 opacity-0 transition-all duration-300 flex items-center gap-3
    ${n==="success"?"bg-status-green-text":"bg-status-red-text"}
  `;const e=document.createElement("span");e.className="font-medium text-sm",e.textContent=a,t.appendChild(e),s.appendChild(t),setTimeout(()=>{t.classList.remove("translate-y-10","opacity-0"),t.classList.add("translate-y-0","opacity-100")},10),setTimeout(()=>{t.classList.remove("translate-y-0","opacity-100"),t.classList.add("translate-y-10","opacity-0"),setTimeout(()=>{t.remove()},300)},3e3)}export{o as s};
