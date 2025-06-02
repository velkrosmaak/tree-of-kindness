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
    const jarImage = document.getElementById('jarImage');
    const cobnutCounterJarDisplay = document.getElementById('cobnutCounterJar');
    const totalCobnutsDisplay = document.getElementById('totalCobnutsDisplay');
    const animationContainer = document.getElementById('animationContainer');
    const funAnimationImg = document.getElementById('funAnimation');

    // Data from HTML (passed by Flask's url_for for default animation)
    const emptyJarSrc = jarImage.dataset.emptySrc;
    const fullJarSrc = jarImage.dataset.fullSrc;
    const defaultAnimationGifSrc = animationContainer.dataset.animationGifSrc;

    // Sound
    const cobnutDropSound = new Audio('/static/audio/cobnut_sound.mp3'); // Ensure this file exists
    cobnutDropSound.preload = 'auto';

    // --- NEW: For Celebration Sounds ---
    let celebrationSoundsList = [];
    const celebrationAudioPlayer = new Audio(); // Reusable Audio object for celebration
    // --- END NEW ---

    // App State
    let selectedUserId = null;
    let currentUserTarget = 10;
    let currentUserAnimationGifUrl = defaultAnimationGifSrc;

    let isDraggingDesktop = false;
    let isDraggingTouch = false;
    let dragClone = null;
    let touchOffsetX = 0, touchOffsetY = 0;

    // --- NEW: Fetch Celebration Sounds ---
    async function fetchCelebrationSounds() {
        try {
            const response = await fetch('/api/celebration_sounds');
            if (!response.ok) {
                console.error('Failed to fetch celebration sounds list, status:', response.status);
                celebrationSoundsList = []; // Ensure it's an empty array on failure
                return;
            }
            celebrationSoundsList = await response.json();
            if (!Array.isArray(celebrationSoundsList)) {
                console.error('Celebration sounds API did not return an array:', celebrationSoundsList);
                celebrationSoundsList = [];
            }
            console.log("Celebration sounds loaded:", celebrationSoundsList);
        } catch (error) {
            console.error('Error fetching celebration sounds:', error);
            celebrationSoundsList = [];
        }
    }
    // --- END NEW ---

    async function loadUsers() {
        try {
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error('Failed to fetch users');
            const users = await response.json();

            userListDiv.innerHTML = '';
            if (users.length === 0) {
                userListDiv.innerHTML = '<p>No users configured. Please visit the <a href="/admin">Admin Panel</a> to add users.</p>';
                return;
            }

            users.forEach(user => {
                const userCard = document.createElement('div');
                userCard.className = 'user-card';
                userCard.dataset.userId = user.id;
                // User data is passed directly to selectUser now

                const img = document.createElement('img');
                img.src = user.profile_picture_url || '/static/images/cobnut.png'; // Default profile pic
                img.alt = user.name;

                const nameP = document.createElement('p');
                nameP.textContent = user.name;

                userCard.appendChild(img);
                userCard.appendChild(nameP);
                userCard.addEventListener('click', () => {
                    selectUser(
                        user.id,
                        user.name,
                        user.profile_picture_url,
                        user.cobnuts_target,
                        user.animation_gif_url // Pass specific animation URL
                    );
                });
                userListDiv.appendChild(userCard);
            });
        } catch (error) {
            console.error("Error loading users:", error);
            userListDiv.innerHTML = '<p>Error loading users. Please try again or check admin setup.</p>';
        }
    }

    function selectUser(userId, name, picUrl, target, animationUrl) {
        selectedUserId = userId;
        currentUserTarget = target;
        currentUserAnimationGifUrl = animationUrl || defaultAnimationGifSrc;
        localStorage.setItem('selectedUserId', userId);

        currentUserName.textContent = name;
        currentUserProfilePic.src = picUrl || '/static/images/cobnut.png';

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
            if (data.error) {
                console.error("Error from server fetching status:", data.error);
                alert("Could not load your cobnut data."); return;
            }
            currentUserTarget = data.cobnuts_target;
            currentUserAnimationGifUrl = data.animation_gif_url || defaultAnimationGifSrc;
            updateDisplay(data.current_cobnuts, data.total_cobnuts);
            jarImage.src = (data.current_cobnuts >= currentUserTarget) ? fullJarSrc : emptyJarSrc;
        } catch (error) {
            console.error("Could not fetch user cobnut status:", error);
            cobnutCounterJarDisplay.textContent = "Error"; totalCobnutsDisplay.textContent = "Error";
            jarImage.src = emptyJarSrc;
        }
    }

    function updateDisplay(current, total) {
        cobnutCounterJarDisplay.textContent = `${current}/${currentUserTarget}`;
        totalCobnutsDisplay.textContent = total;
        jarImage.src = (current >= currentUserTarget) ? fullJarSrc : (current === 0 ? emptyJarSrc : jarImage.src);
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
            if (cobnutDropSound) {
                cobnutDropSound.currentTime = 0;
                cobnutDropSound.play().catch(e => console.warn("Cobnut sound playback failed:", e));
            }
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
        console.log("Playing animation with URL:", currentUserAnimationGifUrl);
        if (!currentUserAnimationGifUrl) {
            console.error("Animation GIF URL is missing!");
            alert("Congratulations! The jar is full! (Animation error: Missing GIF URL)");
            await triggerServerJarReset(); return;
        }
        funAnimationImg.src = currentUserAnimationGifUrl + '?t=' + new Date().getTime();
        animationContainer.classList.remove('hidden');
        animationContainer.classList.add('visible');
        document.querySelector('.game-area').style.display = 'none';
        document.querySelector('.stats-area').style.display = 'none';

        // --- Play Random Celebration Sound ---
        if (celebrationSoundsList && celebrationSoundsList.length > 0) {
            const randomIndex = Math.floor(Math.random() * celebrationSoundsList.length);
            const randomSoundUrl = celebrationSoundsList[randomIndex];
            console.log("Playing celebration sound:", randomSoundUrl);
            celebrationAudioPlayer.src = randomSoundUrl;
            celebrationAudioPlayer.currentTime = 0;
            celebrationAudioPlayer.play().catch(error => {
                console.warn("Celebration sound playback failed:", error);
            });
        } else {
            console.log("No celebration sounds loaded or list is empty.");
        }
        // --- END Play Random Celebration Sound ---

        funAnimationImg.onload = () => console.log("Animation GIF loaded.");
        funAnimationImg.onerror = async () => {
            console.error("Error loading animation GIF:", currentUserAnimationGifUrl, ". Trying default.");
            funAnimationImg.src = defaultAnimationGifSrc + '?t=' + new Date().getTime(); // Try default as ultimate fallback
            funAnimationImg.onerror = async () => { // If default also fails
                 console.error("Default animation also failed to load.");
                 alert("Congratulations! The jar is full! (Failed to load any animation image).");
                 animationContainer.classList.remove('visible'); animationContainer.classList.add('hidden');
                 await triggerServerJarReset();
            };
        };

        return new Promise(resolve => {
            setTimeout(async () => {
                animationContainer.classList.remove('visible'); animationContainer.classList.add('hidden');
                funAnimationImg.src = "#";
                document.querySelector('.game-area').style.display = 'flex';
                document.querySelector('.stats-area').style.display = 'block';
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
            console.error("Could not reset jar:", error);
            alert("Issue resetting jar.");
        }
    }
    
    function showUserSelection() {
        appContainer.style.display = 'none';
        userSelectionScreen.style.display = 'flex';
        loadUsers();
    }

    function initializeApp() {
        fetchCelebrationSounds(); // <<< Fetch sounds on app init
        const previouslySelectedUserId = localStorage.getItem('selectedUserId');
        if (previouslySelectedUserId) {
            fetch('/api/users').then(res => {
                if (!res.ok) throw new Error(`API users fetch failed: ${res.status}`);
                return res.json();
                })
            .then(users => {
                const prevUser = users.find(u => u.id === parseInt(previouslySelectedUserId));
                if (prevUser) {
                    selectUser(prevUser.id, prevUser.name, prevUser.profile_picture_url, prevUser.cobnuts_target, prevUser.animation_gif_url);
                } else {
                    localStorage.removeItem('selectedUserId');
                    showUserSelection();
                }
            }).catch(err => {
                console.error("Failed to pre-select user:", err);
                showUserSelection();
            });
        } else {
            showUserSelection();
        }
    }

    initializeApp();
});