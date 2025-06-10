document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const userSelectionScreen = document.getElementById('userSelectionScreen');
    const userListDiv = document.getElementById('userList');
    const appContainer = document.getElementById('appContainer');
    const changeUserButton = document.getElementById('changeUserButton');
    const currentUserProfilePic = document.getElementById('currentUserProfilePic');
    const currentUserName = document.getElementById('currentUserName');
    const draggableCobnut = document.getElementById('draggableCobnut');
    const jarArea = document.getElementById('jarArea');
    const cobnutsInJarContainer = document.getElementById('cobnutsInJarContainer');
    const jarImage = document.getElementById('jarImage');
    const cobnutCounterJarDisplay = document.getElementById('cobnutCounterJar');
    const totalCobnutsDisplay = document.getElementById('totalCobnutsDisplay');
    const animationContainer = document.getElementById('animationContainer');
    const funAnimationImg = document.getElementById('funAnimation');

    // Data from HTML
    const emptyJarSrc = jarImage.dataset.emptySrc;
    const fullJarSrc = jarImage.dataset.fullSrc;
    const defaultAnimationGifSrc = animationContainer.dataset.animationGifSrc;

    // Sound Objects
    const cobnutDropSound = new Audio('/static/audio/cobnut_sound.mp3');
    cobnutDropSound.preload = 'auto';
    const celebrationAudioPlayer = new Audio();
    
    // App State
    let celebrationSoundsList = [];
    let selectedUserId = null;
    let currentUserTarget = 10;
    let currentUserAnimationGifUrl = defaultAnimationGifSrc;
    let isDraggingDesktop = false;
    let isDraggingTouch = false;
    let dragClone = null;
    let touchOffsetX = 0, touchOffsetY = 0;

    // Positions for visual cobnuts: [left (%), top (%), rotation (deg)]
    const cobnutPositions = [
        [50, 80, -10], [35, 78, 15], [65, 75, 5],  [45, 70, -25], [58, 68, 20],
        [30, 65, -5],  [70, 62, 30], [40, 58, 10], [60, 55, -15], [50, 50, 0],
        [35, 48, 25],  [65, 45, -5], [45, 40, -20],[55, 35, 15], [40, 30, 5]
    ];

    function renderCobnutsInJar(count) {
        cobnutsInJarContainer.innerHTML = '';
        if (count === 0) return;
        const cobnutImgSrc = draggableCobnut.querySelector('img').src;
        for (let i = 0; i < count; i++) {
            if (i >= cobnutPositions.length) break;
            const pos = cobnutPositions[i];
            const cobnutEl = document.createElement('img');
            cobnutEl.src = cobnutImgSrc;
            cobnutEl.className = 'cobnut-in-jar';
            cobnutEl.style.left = `${pos[0]}%`;
            cobnutEl.style.top = `${pos[1]}%`;
            cobnutEl.style.transform = `rotate(${pos[2]}deg) translate(-50%, -50%)`; // Center the image on the coords
            cobnutsInJarContainer.appendChild(cobnutEl);
        }
    }

    async function fetchCelebrationSounds() {
        try {
            const response = await fetch('/api/celebration_sounds');
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            celebrationSoundsList = await response.json();
            if (!Array.isArray(celebrationSoundsList)) celebrationSoundsList = [];
            console.log("Celebration sounds loaded:", celebrationSoundsList.length);
        } catch (error) {
            console.error('Error fetching celebration sounds:', error);
            celebrationSoundsList = [];
        }
    }

    async function loadUsers() {
        try {
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error('Failed to fetch users');
            const users = await response.json();
            userListDiv.innerHTML = '';
            if (users.length === 0) {
                userListDiv.innerHTML = '<p>No users configured. Please visit the <a href="/admin/dashboard">Admin Dashboard</a> to add users.</p>';
                return;
            }
            users.forEach(user => {
                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                const img = document.createElement('img');
                img.src = user.profile_picture_url || '/static/images/cobnut.png';
                img.alt = user.name;
                const nameP = document.createElement('p');
                nameP.textContent = user.name;
                userCard.append(img, nameP);
                userCard.addEventListener('click', () => selectUser(user));
                userListDiv.appendChild(userCard);
            });
        } catch (error) {
            console.error("Error loading users:", error);
            userListDiv.innerHTML = '<p>Error loading users. Please try again.</p>';
        }
    }

    function selectUser(user) {
        selectedUserId = user.id;
        currentUserTarget = user.cobnuts_target;
        currentUserAnimationGifUrl = user.animation_gif_url || defaultAnimationGifSrc;
        localStorage.setItem('selectedUserId', user.id);
        currentUserName.textContent = user.name;
        currentUserProfilePic.src = user.profile_picture_url || '/static/images/cobnut.png';
        cobnutsInJarContainer.innerHTML = '';
        userSelectionScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        fetchAndUpdateUserStatus();
    }

    changeUserButton.addEventListener('click', () => {
        selectedUserId = null;
        localStorage.removeItem('selectedUserId');
        appContainer.style.display = 'none';
        userSelectionScreen.style.display = 'flex';
        currentUserAnimationGifUrl = defaultAnimationGifSrc;
        loadUsers();
    });

    async function fetchAndUpdateUserStatus() {
        if (!selectedUserId) return;
        try {
            const response = await fetch(`/api/user_status/${selectedUserId}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            currentUserTarget = data.cobnuts_target;
            currentUserAnimationGifUrl = data.animation_gif_url || defaultAnimationGifSrc;
            updateDisplay(data.current_cobnuts, data.total_cobnuts);
            renderCobnutsInJar(data.current_cobnuts);
            jarImage.src = (data.current_cobnuts >= currentUserTarget) ? fullJarSrc : emptyJarSrc;
        } catch (error) {
            console.error("Could not fetch user cobnut status:", error);
            cobnutCounterJarDisplay.textContent = "Error"; totalCobnutsDisplay.textContent = "Error";
            jarImage.src = emptyJarSrc;
        }
    }

    function updateDisplay(current, total) {
        cobnutCounterJarDisplay.textContent = `${current}/${currentUserTarget}`;
        cobnutCounterJarDisplay.classList.add('counter-pop');
        setTimeout(() => cobnutCounterJarDisplay.classList.remove('counter-pop'), 200);
        totalCobnutsDisplay.textContent = total;
    }

    async function handleCobnutDrop() {
        if (!selectedUserId) { alert("Please select a user first!"); return; }
        try {
            const response = await fetch(`/api/add_cobnut/${selectedUserId}`, { method: 'POST' });
            if (!response.ok) {
                 const errorData = await response.json().catch(() => ({error: "Server error"}));
                 throw new Error(errorData.error || `Server error: ${response.status}`);
            }
            const data = await response.json();
            updateDisplay(data.current_cobnuts, data.total_cobnuts);
            renderCobnutsInJar(data.current_cobnuts);
            cobnutDropSound.currentTime = 0;
            cobnutDropSound.play().catch(e => console.warn("Cobnut sound playback failed:", e));
            if (data.animation_triggered) await playAnimationAndReset();
        } catch (error) {
            console.error("Could not add cobnut:", error);
            alert(`Error adding cobnut: ${error.message}`);
        }
    }

    draggableCobnut.addEventListener('dragstart', (e) => {isDraggingDesktop = true; e.dataTransfer.setData('text/plain', 'cobnut'); draggableCobnut.classList.add('dragging');});
    draggableCobnut.addEventListener('dragend', () => {isDraggingDesktop = false; draggableCobnut.classList.remove('dragging');});
    jarArea.addEventListener('dragover', (e) => {e.preventDefault(); jarArea.classList.add('drag-over');});
    jarArea.addEventListener('dragleave', () => {jarArea.classList.remove('drag-over');});
    jarArea.addEventListener('drop', async (e) => {e.preventDefault(); jarArea.classList.remove('drag-over'); if (isDraggingDesktop) await handleCobnutDrop(); isDraggingDesktop = false;});
    draggableCobnut.addEventListener('touchstart', (e) => {if (e.targetTouches.length === 1) {isDraggingTouch = true; const touch = e.targetTouches[0]; const rect = draggableCobnut.getBoundingClientRect(); dragClone = draggableCobnut.querySelector('img').cloneNode(true); dragClone.id = "draggableCobnutClone"; document.body.appendChild(dragClone); touchOffsetX = touch.clientX - rect.left; touchOffsetY = touch.clientY - rect.top; dragClone.style.left = (touch.clientX - touchOffsetX) + 'px'; dragClone.style.top = (touch.clientY - touchOffsetY) + 'px'; draggableCobnut.style.opacity = '0.5';}}, { passive: true });
    document.body.addEventListener('touchmove', (e) => {if (isDraggingTouch && dragClone && e.targetTouches.length === 1) {e.preventDefault(); const touch = e.targetTouches[0]; dragClone.style.left = (touch.clientX - touchOffsetX) + 'px'; dragClone.style.top = (touch.clientY - touchOffsetY) + 'px';}}, { passive: false });
    document.body.addEventListener('touchend', async (e) => {if (isDraggingTouch && dragClone) {const touch = e.changedTouches[0]; dragClone.style.display = 'none'; const droppedElement = document.elementFromPoint(touch.clientX, touch.clientY); if (jarArea.contains(droppedElement) || droppedElement === jarArea) await handleCobnutDrop(); document.body.removeChild(dragClone); dragClone = null; draggableCobnut.style.opacity = '1'; isDraggingTouch = false;}});

    async function playAnimationAndReset() {
        if (!currentUserAnimationGifUrl) {
            alert("Congratulations! The jar is full! (Animation error: Missing GIF URL)");
            await triggerServerJarReset(); return;
        }
        funAnimationImg.src = currentUserAnimationGifUrl + '?t=' + new Date().getTime();
        animationContainer.classList.remove('hidden');
        animationContainer.classList.add('visible');
        document.querySelector('.game-area').style.display = 'none';
        document.querySelector('.stats-area').style.display = 'none';

        if (celebrationSoundsList.length > 0) {
            const randomIndex = Math.floor(Math.random() * celebrationSoundsList.length);
            const randomSoundUrl = celebrationSoundsList[randomIndex];
            celebrationAudioPlayer.src = randomSoundUrl;
            celebrationAudioPlayer.currentTime = 0;
            celebrationAudioPlayer.play().catch(e => console.warn("Celebration sound playback failed:", e));
        }

        funAnimationImg.onerror = async () => {
            funAnimationImg.src = defaultAnimationGifSrc + '?t=' + new Date().getTime();
            funAnimationImg.onerror = async () => {
                 alert("Congratulations! (Failed to load any animation image).");
                 animationContainer.classList.add('hidden'); await triggerServerJarReset();
            };
        };

        return new Promise(resolve => {
            setTimeout(async () => {
                animationContainer.classList.add('hidden'); funAnimationImg.src = "#";
                document.querySelector('.game-area').style.display = 'flex';
                document.querySelector('.stats-area').style.display = 'block';
                renderCobnutsInJar(0);
                await triggerServerJarReset();
                resolve();
            }, 5000);
        });
    }

    async function triggerServerJarReset() {
        if (!selectedUserId) return;
        try {
            const response = await fetch(`/api/reset_jar/${selectedUserId}`, { method: 'POST' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            updateDisplay(data.current_cobnuts, data.total_cobnuts);
        } catch (error) {
            console.error("Could not reset jar:", error); alert("Issue resetting jar.");
        }
    }
    
    function showUserSelection() {
        appContainer.style.display = 'none';
        userSelectionScreen.style.display = 'flex';
        loadUsers();
    }

    function initializeApp() {
        fetchCelebrationSounds();
        const previouslySelectedUserId = localStorage.getItem('selectedUserId');
        if (previouslySelectedUserId) {
            fetch('/api/users').then(res => res.ok ? res.json() : Promise.reject(res))
            .then(users => {
                const prevUser = users.find(u => u.id === parseInt(previouslySelectedUserId));
                if (prevUser) { selectUser(prevUser); } 
                else { localStorage.removeItem('selectedUserId'); showUserSelection(); }
            }).catch(err => { console.error("Failed to pre-select user:", err); showUserSelection(); });
        } else {
            showUserSelection();
        }
    }

    initializeApp();
});