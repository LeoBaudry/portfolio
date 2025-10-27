<script>
  import { onMount, tick } from 'svelte';
  import { gsap } from 'gsap';
  
  export let projects = [];

  let viewMode = 'list'; // Vue de base : "list" ou "grid"
  let hoveredImage = null;
  let mousePos = { x: 0, y: 0 };
  let hasMounted = false;
  
  // stocker la largeur de la fenêtre
  let viewportWidth = 0; 
  
  // logique de positionnement
  const imageWidth = 384; // w-96 = 24rem = 384px
  const imageOffset = 20; 

  const categories = ['Tous', 'Identité', 'Motion Design', '3D / Modélisation'];
  let activeCategory = 'Tous';

  $: filteredProjects = projects.filter(p => {
    const matchesCategory = 
      activeCategory === 'Tous' || 
      (p.categories && p.categories.includes(activeCategory));
    return matchesCategory;
  });

  // --- ANIMATION GSAP ---
  function animateUpdate() {
    gsap.from(".project-item", {
      opacity: 0,
      y: 30,
      duration: 0.5,
      stagger: 0.1, 
      ease: "power3.out",
      overwrite: 'auto',
      clearProps: "opacity,transform" 
    });
  }

  async function animateInitialLoad() {
    await tick(); 
    gsap.fromTo(".project-item",
      { opacity: 0, y: 30 }, 
      {                     
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.1,
        ease: "power3.out",
        overwrite: 'auto'
      }
    );
  }
  
  let isInitialLoad = true;
  onMount(() => {
    hasMounted = true; 
    animateInitialLoad(); 
    gsap.delayedCall(0.5 + 0.1 * projects.length + 0.1, () => {
         isInitialLoad = false;
     });
  });


  $: if (hasMounted && !isInitialLoad && (filteredProjects || viewMode)) {
    const reAnimate = async () => {
      await tick(); 
      animateUpdate(); 
    }
    reAnimate();
  }

</script>

<svelte:window 
  on:mousemove={e => mousePos = { x: e.clientX, y: e.clientY }} 
  bind:innerWidth={viewportWidth}
/>

<div class="w-full text-black mb-52">
  
  <div class="flex flex-col md:flex-row justify-between items-center gap-8 mt-12 mb-6">
    
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-normal">
      <span class="text-gray-500">Filtres :</span>
      {#each categories as category}
        <button
          on:click={() => activeCategory = category}
          class="pb-1 transition-all"
          class:text-black={activeCategory === category}
          class:font-medium={activeCategory === category}
          class:text-gray-400={activeCategory !== category}
        >
          {category}
        </button>
      {/each}
    </div>

    <div class="flex items-center gap-2 font-semibold text-sm uppercase tracking-normal">
      <button
        on:click={() => viewMode = 'list'}
        class="px-3 py-1 rounded-md transition-colors"
        class:text-white={viewMode === 'list'}
        class:bg-[#F3471C]={viewMode === 'list'}
        class:text-black={viewMode !== 'list'}
        class:bg-transparent={viewMode !== 'list'}
      >
        • LISTE
      </button>
      <button
        on:click={() => viewMode = 'grid'}
        class="px-3 py-1 rounded-md transition-colors"
        class:text-white={viewMode === 'grid'}
        class:bg-[#F3471C]={viewMode === 'grid'}
        class:text-black={viewMode !== 'grid'}
        class:bg-transparent={viewMode !== 'grid'}
      >
        • GRILLE
      </button>
    </div>
  </div>

  {#if viewMode === 'grid'}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      {#each filteredProjects as project (project.id)}
        <a 
          href={`/projets/${project.slug}`} 
          class="project-item relative aspect-[4/3] rounded-lg overflow-hidden group shadow-md"
        >
          <img 
            src={project.coverImageUrl} 
            alt={project.title} 
            class="w-full h-full object-cover transition-transform duration-300 ease-in-out group-hover:scale-105"
          />
          <div 
            class="absolute inset-0 p-6 flex flex-col justify-end
                   opacity-0 group-hover:opacity-100 
                   bg-gradient-to-t from-black/70 to-transparent
                   transition-opacity duration-300 ease-in-out"
          >
            <h3 
              class="text-white font-bold text-2xl
                     transform translate-y-4 group-hover:translate-y-0 
                     transition-transform duration-300 ease-in-out"
            >
              {project.title}
            </h3>
            <div 
              class="absolute bottom-6 right-6 text-right text-white text-xs font-mono
                     opacity-0 group-hover:opacity-100 
                     transform translate-y-4 group-hover:translate-y-0
                     transition-all duration-300 delay-100 ease-in-out"
            >
              {#if Array.isArray(project.technologies)}
                {project.technologies.join(' / ')}
              {/if}
            </div>
          </div>
        </a>
      {/each}
    </div>

  {:else if viewMode === 'list'}
    <div 
      class="border-t border-gray-200 pt-6"
      on:mouseleave={() => hoveredImage = null}
      role="list"
    >
      <div class="hidden md:grid grid-cols-12 gap-4 py-3 text-xs text-gray-400 uppercase font-normal">
        <span class="col-span-3 text-left">Commanditaire</span>
        <span class="col-span-2 col-start-8 text-right">Projet</span>
        <span class="col-span-3 text-right">Type</span>
      </div>
      
      {#each filteredProjects as project (project.id)}
        <a 
          href={`/projets/${project.slug}`}
          class="project-item flex flex-col gap-1 py-3 px-3
                 md:grid md:grid-cols-12 md:items-center md:py-2
                 text-black bg-white
                 hover:bg-black hover:text-white
                 transition-colors duration-150 cursor-pointer group"
          on:mouseenter={() => hoveredImage = project.coverImageUrl}
        >
          <span class="md:col-span-3 text-left font-semibold text-sm tracking-[-0.05em] group-hover:text-white">{project.client}</span>
          <span class="md:col-start-8 md:col-span-2 text-left md:text-right text-xl font-semibold tracking-[-0.05em] group-hover:text-white">{project.title}</span> 
          <span class="md:col-span-3 text-left md:text-right text-xs text-gray-600 group-hover:text-white uppercase tracking-[-0.05em] font-medium">
            {project.type}
          </span>
        </a>
      {/each}
    </div>
  {/if}

  <div 
      class="fixed w-96 aspect-video rounded-md overflow-hidden shadow-2xl
             pointer-events-none z-50
             transition-opacity duration-200"
      style="
        left: {mousePos.x + imageOffset + imageWidth > viewportWidth 
          ? mousePos.x - imageWidth - imageOffset 
          : mousePos.x + imageOffset}px; 
        top: {mousePos.y + imageOffset}px; 
        opacity: {hoveredImage && viewMode === 'list' ? 1 : 0};
      "
    >
      <img src={hoveredImage} alt="Aperçu" class="w-full h-full object-cover" />
    </div>

</div>