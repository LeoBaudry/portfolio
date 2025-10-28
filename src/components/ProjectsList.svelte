<script>
  import { onMount, tick } from 'svelte';
  import { gsap } from 'gsap';
  
  let { projects = [] } = $props();

  let viewMode = $state('list');
  let hoveredImage = $state(null);
  let mousePos = $state({ x: 0, y: 0 });
  let hasMounted = $state(false);
  let viewportWidth = $state(0);
  let isInitialLoad = $state(true);
  
  const imageWidth = 384;
  const imageOffset = 20;

  const categories = ['Tous', 'Identité', 'Motion Design', '3D / Modélisation'];
  let activeCategory = $state('Tous');

  let filteredProjects = $derived(projects.filter(p => {
    const matchesCategory = 
      activeCategory === 'Tous' || 
      (p.categories && p.categories.includes(activeCategory));
    return matchesCategory;
  }));

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
  
  onMount(() => {
    hasMounted = true; 
    animateInitialLoad(); 
    gsap.delayedCall(0.5 + 0.1 * projects.length + 0.1, () => {
      isInitialLoad = false;
    });
  });

  $effect(() => {
    if (hasMounted && !isInitialLoad) {
      filteredProjects;
      viewMode;
      animateUpdate();
    }
  });
</script>

<svelte:window 
  onmousemove={e => mousePos = { x: e.clientX, y: e.clientY }} 
  bind:innerWidth={viewportWidth}
/>

<section class="w-full text-black mb-52" aria-labelledby="projects-heading">
  <h2 id="projects-heading" class="sr-only">Liste des projets</h2>
  
  <header class="flex flex-col md:flex-row justify-between items-center gap-8 mt-12 mb-6">
    
    <nav aria-label="Filtres de catégories" class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-normal">
      <span class="text-gray-500" id="filter-label">Filtres :</span>
      <div role="group" aria-labelledby="filter-label" class="flex flex-wrap gap-x-4 gap-y-2">
        {#each categories as category}
          <button
            type="button"
            onclick={() => activeCategory = category}
            class="cursor-pointer pb-1 transition-all"
            class:text-black={activeCategory === category}
            class:font-medium={activeCategory === category}
            class:text-gray-600={activeCategory !== category}
            aria-pressed={activeCategory === category}
            aria-label={`Filtrer par ${category}`}
          >
            {category}
          </button>
        {/each}
      </div>
    </nav>

    <div role="group" aria-label="Mode d'affichage" class="flex items-center gap-2 font-bold text-[15px] uppercase tracking-normal">
      <button
        type="button"
        onclick={() => viewMode = 'list'}
        class="cursor-pointer px-3 py-1 rounded-md transition-colors"
        class:text-white={viewMode === 'list'}
        class:bg-[#111111]={viewMode === 'list'}
        class:text-black={viewMode !== 'list'}
        class:bg-transparent={viewMode !== 'list'}
        aria-pressed={viewMode === 'list'}
        aria-label="Afficher en mode liste"
      >
        • LISTE
      </button>
      <button
        type="button"
        onclick={() => viewMode = 'grid'}
        class="cursor-pointer px-3 py-1 rounded-md transition-colors"
        class:text-white={viewMode === 'grid'}
        class:bg-[#111111]={viewMode === 'grid'}
        class:text-black={viewMode !== 'grid'}
        class:bg-transparent={viewMode !== 'grid'}
        aria-pressed={viewMode === 'grid'}
        aria-label="Afficher en mode grille"
      >
        • GRILLE
      </button>
    </div>
  </header>

  <div 
    role="region" 
    aria-live="polite" 
    aria-atomic="true"
    class="sr-only"
  >
    {filteredProjects.length} {filteredProjects.length === 1 ? 'projet trouvé' : 'projets trouvés'}
  </div>

  {#if viewMode === 'grid'}
    <ul class="grid grid-cols-1 md:grid-cols-2 gap-6" role="list">
      {#each filteredProjects as project (project.id)}
        <li class="project-item">
          <a 
            href={`/projets/${project.slug}`} 
            class="relative aspect-[4/3] rounded-lg overflow-hidden group shadow-md block"
            aria-label={`${project.title} - ${project.type}`}
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
              aria-hidden="true"
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
        </li>
      {/each}
    </ul>

  {:else if viewMode === 'list'}
    <div 
      role="presentation"
      class="border-t border-gray-200 pt-6"
      onmouseleave={() => hoveredImage = null}
    >
      <div class="hidden md:grid grid-cols-12 gap-4 py-3 text-xs text-gray-600 uppercase font-normal" aria-hidden="true">
        <span class="col-span-3 text-left">Commanditaire</span>
        <span class="col-span-2 col-start-8 text-right">Projet</span>
        <span class="col-span-3 text-right">Type</span>
      </div>
      
      <ul role="list">
        {#each filteredProjects as project (project.id)}
          <li class="project-item">
            <a 
              href={`/projets/${project.slug}`}
              class="flex flex-col gap-1 py-3 px-3
                    md:grid md:grid-cols-12 md:items-center md:py-2
                    text-black bg-white
                    hover:bg-black hover:text-white
                    transition-colors duration-150 cursor-pointer group"
              onmouseenter={() => hoveredImage = project.coverImageUrl}
              aria-label={`${project.title} - ${project.type} pour ${project.client}`}
            >
              <span class="md:col-span-3 text-left font-semibold text-sm tracking-[-0.05em] group-hover:text-white">{project.client}</span>
              <span class="md:col-start-8 md:col-span-2 text-left md:text-right text-xl font-semibold tracking-[-0.05em] group-hover:text-white">{project.title}</span> 
              <span class="md:col-span-3 text-left md:text-right text-xs text-gray-600 group-hover:text-white uppercase tracking-[-0.05em] font-medium">
                {project.type}
              </span>
            </a>
          </li>
        {/each}
      </ul>
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
    aria-hidden="true"
    role="presentation"
  >
    {#if hoveredImage}
      <img src={hoveredImage} alt="" class="w-full h-full object-cover" />
    {/if}
  </div>
</section>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
