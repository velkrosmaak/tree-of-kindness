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
    const defaultAnimationGifSrc = animationContainer.dataset.animationGifSrc; // Fallback

    // Sound
    const cobnutDropSound = new Audio('/static/audio/cobnut_sound.mp3');
    cobnutDropSound.preload = 'auto';

    // App State
    let selectedUserId = null;
    let currentUserTarget = 10;
    let currentUserAnimationGifUrl = defaultAnimationGifSrc; // Initialize with default

    let isDraggingDesktop = false;
    let isDraggingTouch = false;
    let dragClone = null;
    let touchOffsetX = 0, touchOffsetY = 0;

    // --- User Selection ---
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
                // Store all necessary user data on the card element
                userCard.dataset.userId = user.id;
                userCard.dataset.userName = user.name;
                userCard.dataset.userPic = user.profile_picture_url || '/static/images/cobnut.png'; // Default profile pic
                userCard.dataset.userTarget = user.cobnuts_target;
                userCard.dataset.userAnimation = user.animation_gif_url || defaultAnimationGifSrc; // User's animation or default

                const img = document.createElement('img');
                img.src = user.profile_picture_url || '/static/images/cobnut.png';
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

    function selectUser(userId, name, picUrl, target, animationUrl) { // Added animationUrl
        selectedUserId = userId;
        currentUserTarget = target;
        currentUserAnimationGifUrl = animationUrl || defaultAnimationGifSrc; // Use user's or default
        localStorage.setItem('selectedUserId', userId);

        currentUserName.textContent = name;
        currentUserProfilePic.src = picUrl || '/static/images/cobnut.png';

        userSelectionScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        fetchAndUpdateUserStatus(); // This will also update target and animation if needed from server
    }

    changeUserButton.addEventListener('click', () => {
        selectedUserId = null;
        localStorage.removeItem('selectedUserId');
        appContainer.style.display = 'none';
        userSelectionScreen.style.display = 'flex';
        currentUserAnimationGifUrl = defaultAnimationGifSrc; // Reset to default
        loadUsers();
    });

    // --- Game Logic (User-Specific) ---
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
            currentUserAnimationGifUrl = data.animation_gif_url || defaultAnimationGifSrc; // Update from server
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
        jarImage.src = (current >= currentUserTarget) ? fullJarSrc : (current === 0 ? emptyJarSrc : jarImage.src); // Avoid flicker if intermediate
    }

    async function handleCobnutDrop() {
        if (!selectedUserId) { alert("Please select a user first!"); return; }
        try {
            const response = await fetch(`/api/add_cobnut/${selectedUserId}`, { method: 'POST' });
            if (!response.ok) throw new Error(`Server error: ${response.status}`);
            const data = await response.json();
            updateDisplay(data.current_cobnuts, data.total_cobnuts);
            if (cobnutDropSound) {
                cobnutDropSound.currentTime = 0;
                cobnutDropSound.play().catch(e => console.warn("Sound playback failed:", e));
            }
            if (data.animation_triggered) await playAnimationAndReset();
        } catch (error) {
            console.error("Could not add cobnut:", error);
            alert(`Error adding cobnut: ${error.message}`);
        }
    }

    // --- Drag and Drop Logic (Unchanged) ---
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
        funAnimationImg.src = currentUserAnimationGifUrl + '?t=' + new Date().getTime(); // Use user-specific or default
        animationContainer.classList.remove('hidden');
        animationContainer.classList.add('visible');
        document.querySelector('.game-area').style.display = 'none';
        document.querySelector('.stats-area').style.display = 'none';

        funAnimationImg.onload = () => console.log("User-specific/default GIF loaded.");
        funAnimationImg.onerror = async () => {
            console.error("Error loading user-specific/default GIF. Falling back if possible or just alerting.");
            funAnimationImg.src = defaultAnimationGifSrc + '?t=' + new Date().getTime(); // Try default as ultimate fallback
            funAnimationImg.onerror = async () => { // If default also fails
                 alert("Congratulations! The jar is full! (Failed to load any animation image).");
                 animationContainer.classList.remove('visible'); animationContainer.classList.add('hidden');
                 await triggerServerJarReset();
            }
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

    function initializeApp() {
        const previouslySelectedUserId = localStorage.getItem('selectedUserId');
        if (previouslySelectedUserId) {
            // Attempt to fetch all users and then find the previously selected one
            // This ensures we have the latest data (like animation_gif_url)
            fetch('/api/users').then(res => res.json()).then(users => {
                const prevUser = users.find(u => u.id === parseInt(previouslySelectedUserId));
                if (prevUser) {
                    selectUser(prevUser.id, prevUser.name, prevUser.profile_picture_url, prevUser.cobnuts_target, prevUser.animation_gif_url);
                } else { // Previous user not found (e.g., deleted)
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
    
    function showUserSelection() {
        appContainer.style.display = 'none';
        userSelectionScreen.style.display = 'flex';
        loadUsers();
    }

    initializeApp();
});