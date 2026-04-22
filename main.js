import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDocs, getDoc, addDoc, deleteDoc, updateDoc, query, orderBy, where } from 'firebase/firestore';

// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyAR8nOkH-0Ik8fwcEMgjsnqKXMvR-qQqUk",
    authDomain: "insancemerlang-3b037.firebaseapp.com",
    projectId: "insancemerlang-3b037",
    storageBucket: "insancemerlang-3b037.firebasestorage.app",
    messagingSenderId: "150953324871",
    appId: "1:150953324871:web:fe3d3214ce3bc6e1121c62",
    measurementId: "G-1R8MDPMGPK"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const booksCol = collection(db, "books");
const membersCol = collection(db, "members");
const usersCol = collection(db, "users");
const loansCol = collection(db, "loans");
const returnsCol = collection(db, "returns");

let currentUser = null;
let modalCallback = null;
const DAILY_FINE = 1000;

// ========== HELPER FUNCTIONS ==========
function showToast(msg, isErr = false) {
    const toast = document.createElement("div");
    toast.className = `fixed bottom-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-lg text-white font-medium flex items-center gap-2 ${isErr ? 'bg-rose-500' : 'bg-teal-500'}`;
    toast.innerHTML = `<i class="fas ${isErr ? 'fa-exclamation-triangle' : 'fa-circle-check'}"></i> ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function formatDate(dateStr) { if (!dateStr) return '-'; return new Date(dateStr).toLocaleDateString('id-ID'); }
function getDueDate(loanDate) { const due = new Date(loanDate); due.setDate(due.getDate() + 7); return due.toISOString(); }
function isOverdue(due) { return new Date() > new Date(due); }
function calcLateFee(dueDate, returnDate) {
    const due = new Date(dueDate), ret = new Date(returnDate);
    if (ret <= due) return 0;
    const days = Math.ceil((ret - due) / (1000*60*60*24));
    return days * DAILY_FINE;
}

// Data loading
let cachedBooks = [], cachedMembers = [];
async function loadBooks() { const snap = await getDocs(query(booksCol, orderBy("title"))); cachedBooks = snap.docs.map(d => ({ id: d.id, ...d.data() })); return cachedBooks; }
async function loadMembers() { const snap = await getDocs(query(membersCol, orderBy("name"))); cachedMembers = snap.docs.map(d => ({ id: d.id, ...d.data() })); return cachedMembers; }
async function loadUsers() { const snap = await getDocs(usersCol); return snap.docs.map(d => ({ id: d.id, ...d.data() })); }

async function loadLoansWithDetails() {
    const loansSnap = await getDocs(query(loansCol, orderBy("loanDate", "desc")));
    const loans = loansSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!loans.length) return [];
    const bookIds = [...new Set(loans.map(l => l.bookId).filter(Boolean))];
    const memberIds = [...new Set(loans.map(l => l.memberId).filter(Boolean))];
    const bookMap = new Map();
    for (let id of bookIds) { const docSnap = await getDoc(doc(booksCol, id)); if(docSnap.exists()) bookMap.set(id, docSnap.data()); }
    const memberMap = new Map();
    for (let id of memberIds) { const docSnap = await getDoc(doc(membersCol, id)); if(docSnap.exists()) memberMap.set(id, docSnap.data()); }
    return loans.map(l => ({
        ...l,
        bookTitle: bookMap.get(l.bookId)?.title || '-',
        bookCover: bookMap.get(l.bookId)?.cover || '📖',
        memberName: memberMap.get(l.memberId)?.name || '-'
    }));
}

async function loadReturnsWithDetails() {
    const retSnap = await getDocs(query(returnsCol, orderBy("returnDate", "desc")));
    const returns = retSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!returns.length) return [];
    const result = [];
    for (let ret of returns) {
        const loanDoc = await getDoc(doc(loansCol, ret.loanId));
        if (loanDoc.exists()) {
            const loan = loanDoc.data();
            const bookDoc = await getDoc(doc(booksCol, loan.bookId));
            const memberDoc = await getDoc(doc(membersCol, loan.memberId));
            result.push({
                ...ret,
                bookTitle: bookDoc.exists() ? bookDoc.data().title : '-',
                memberName: memberDoc.exists() ? memberDoc.data().name : '-',
                loanDate: loan.loanDate,
                dueDate: loan.dueDate
            });
        } else result.push({ ...ret, bookTitle: '-', memberName: '-', loanDate: null, dueDate: null });
    }
    return result;
}

// Seed data awal
async function seedInitial() {
    try {
        const adminQuery = query(usersCol, where("username", "==", "admin"));
        if ((await getDocs(adminQuery)).empty) await addDoc(usersCol, { username: "admin", password: "admin123", role: "admin", memberId: null });
        if ((await getDocs(booksCol)).empty) {
            await addDoc(booksCol, { title: "Pengantar React", publisher: "TechPress", totalStock: 6, availableStock: 6, cover: "⚛️" });
            await addDoc(booksCol, { title: "Desain UI/UX", publisher: "ArtHouse", totalStock: 4, availableStock: 4, cover: "🎨" });
            await addDoc(booksCol, { title: "Database MySQL", publisher: "Informatika", totalStock: 5, availableStock: 5, cover: "🗄️" });
        }
        if ((await getDocs(membersCol)).empty) {
            const m1 = await addDoc(membersCol, { name: "Citra Kirana", className: "XI RPL 2", phone: "081234567890", registerDate: new Date().toISOString() });
            await addDoc(usersCol, { username: "citra", password: "citra123", role: "member", memberId: m1.id });
        }
    } catch(e) { console.error(e); }
}
seedInitial();

// ========== MODAL ==========
function openModal(title, html, onConfirm) {
    document.getElementById("modalTitle").innerText = title;
    document.getElementById("modalBody").innerHTML = html;
    document.getElementById("globalModal").classList.remove("hidden");
    modalCallback = onConfirm;
    setTimeout(() => {
        const pwdToggle = document.querySelector('#globalModal .toggle-pwd');
        if (pwdToggle) {
            const inp = pwdToggle.parentElement.querySelector('input');
            pwdToggle.addEventListener('click', () => {
                const type = inp.type === 'password' ? 'text' : 'password';
                inp.type = type;
                pwdToggle.classList.toggle('fa-eye');
                pwdToggle.classList.toggle('fa-eye-slash');
            });
        }
    }, 50);
}
function closeModal() { document.getElementById("globalModal").classList.add("hidden"); modalCallback = null; }
document.getElementById("closeModalBtn").onclick = closeModal;
document.getElementById("modalCancelBtn").onclick = closeModal;
document.getElementById("modalConfirmBtn").onclick = () => { if(modalCallback) modalCallback(); closeModal(); };

// ========== AUTH ==========
async function handleLogin(username, password) {
    if (!username || !password) { showToast("Isi username & password", true); return false; }
    try {
        const q = query(usersCol, where("username", "==", username), where("password", "==", password));
        const snap = await getDocs(q);
        if (snap.empty) { showToast("Login gagal", true); return false; }
        currentUser = { id: snap.docs[0].id, ...snap.docs[0].data() };
        localStorage.setItem("pustaka_user", JSON.stringify({ id: currentUser.id, username: currentUser.username, role: currentUser.role, memberId: currentUser.memberId }));
        showToast(`Selamat datang, ${currentUser.username}`);
        renderDashboard();
        return true;
    } catch(e) { showToast("Error: "+e.message, true); return false; }
}

async function handleRegister(name, className, phone, username, password) {
    if (!name || !className || !username || !password) { showToast("Lengkapi semua field", true); return false; }
    const existing = await getDocs(query(usersCol, where("username", "==", username)));
    if (!existing.empty) { showToast("Username sudah dipakai", true); return false; }
    const memberRef = await addDoc(membersCol, { name, className, phone, registerDate: new Date().toISOString() });
    await addDoc(usersCol, { username, password, role: "member", memberId: memberRef.id });
    showToast("Pendaftaran berhasil! Silakan login.");
    return true;
}

function setupPwdToggle(tId, iId) {
    const toggle = document.getElementById(tId);
    const inp = document.getElementById(iId);
    if(toggle && inp) toggle.addEventListener('click', () => {
        const type = inp.type === 'password' ? 'text' : 'password';
        inp.type = type;
        toggle.classList.toggle('fa-eye');
        toggle.classList.toggle('fa-eye-slash');
    });
}
setupPwdToggle('toggleLoginPwd', 'loginPassword');
setupPwdToggle('toggleRegPwd', 'regPassword');

// ========== RENDER DASHBOARD ==========
async function renderDashboard() {
    document.getElementById("authSection").classList.add("hidden");
    document.getElementById("dashboardSection").classList.remove("hidden");
    document.getElementById("userNameDisplay").innerText = currentUser.username;
    document.getElementById("userRoleBadge").innerHTML = currentUser.role === 'admin' ? '<i class="fas fa-crown mr-1"></i>Admin' : '<i class="fas fa-user mr-1"></i>Anggota';

    const navContainer = document.getElementById("navTabs");
    navContainer.innerHTML = "";
    if (currentUser.role === 'admin') {
        const menus = [
            { id: "adminBooks", label: "📚 Koleksi Buku", icon: "fa-book" },
            { id: "adminMembers", label: "👥 Anggota", icon: "fa-users" },
            { id: "adminLoans", label: "📋 Peminjaman", icon: "fa-hand-holding" },
            { id: "adminReturns", label: "🔄 Pengembalian", icon: "fa-history" },
            { id: "adminFines", label: "💰 Denda", icon: "fa-coins" }
        ];
        menus.forEach(menu => {
            const btn = document.createElement("button");
            btn.className = "nav-pill";
            btn.innerHTML = `<i class="fas ${menu.icon} mr-2"></i>${menu.label}`;
            btn.onclick = () => renderAdminSection(menu.id);
            navContainer.appendChild(btn);
        });
        await renderAdminSection("adminBooks");
    } else {
        const menus = [
            { id: "userBorrow", label: "📖 Pinjam Buku", icon: "fa-book-open" },
            { id: "userLoans", label: "📋 Peminjamanku", icon: "fa-list" },
            { id: "userReturn", label: "↩️ Kembalikan", icon: "fa-undo" },
            { id: "userFines", label: "💰 Dendaku", icon: "fa-coins" }
        ];
        menus.forEach(menu => {
            const btn = document.createElement("button");
            btn.className = "nav-pill";
            btn.innerHTML = `<i class="fas ${menu.icon} mr-2"></i>${menu.label}`;
            btn.onclick = () => renderUserSection(menu.id);
            navContainer.appendChild(btn);
        });
        await renderUserSection("userBorrow");
    }
}

// --------------------- ADMIN SECTIONS ---------------------
async function renderAdminSection(section) {
    const container = document.getElementById("contentPanel");
    if (section === "adminBooks") await renderAdminBooks(container);
    else if (section === "adminMembers") await renderAdminMembers(container);
    else if (section === "adminLoans") await renderAdminLoans(container);
    else if (section === "adminReturns") await renderAdminReturns(container);
    else if (section === "adminFines") await renderAdminFines(container);
}

async function renderAdminBooks(container) {
    let books = await loadBooks();
    container.innerHTML = `
        <div class="flex justify-between items-center flex-wrap mb-5"><h2 class="text-2xl font-bold text-teal-700"><i class="fas fa-book mr-2"></i>Manajemen Buku</h2><button id="addBookBtn" class="btn-primary text-white px-5 py-2 rounded-xl shadow"><i class="fas fa-plus mr-2"></i>Tambah Buku</button></div>
        <div class="overflow-x-auto"><table class="w-full table-modern bg-white/60 rounded-2xl"><thead class="bg-teal-50 text-teal-800"><tr><th>Cover</th><th>Judul</th><th>Penerbit</th><th>Stok</th><th>Tersedia</th><th>Aksi</th></tr></thead><tbody id="booksTableBody"></tbody></table></div>
    `;
    const render = () => {
        document.getElementById("booksTableBody").innerHTML = books.map(b => `<tr><td class="text-3xl">${b.cover || '📚'}</td><td class="font-semibold">${b.title}</td><td>${b.publisher || '-'}</td><td>${b.totalStock}</td><td>${b.availableStock}</td><td><button data-id="${b.id}" class="editBook text-teal-600 mr-3"><i class="fas fa-edit"></i></button><button data-id="${b.id}" class="delBook text-rose-500"><i class="fas fa-trash"></i></button></td></tr>`).join('');
        document.querySelectorAll(".editBook").forEach(btn => btn.onclick = () => editBook(btn.dataset.id));
        document.querySelectorAll(".delBook").forEach(btn => btn.onclick = () => deleteBook(btn.dataset.id));
    };
    render();
    document.getElementById("addBookBtn").onclick = () => {
        openModal("Tambah Buku", `<div class="mb-3"><label>Cover (emoji)</label><input id="cov" class="w-full border rounded-xl p-2" value="📘"></div><div class="mb-3"><label>Judul</label><input id="title" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Penerbit</label><input id="pub" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Stok Total</label><input id="stock" type="number" class="w-full border rounded-xl p-2"></div>`, async () => {
            const title = document.getElementById("title").value;
            const total = parseInt(document.getElementById("stock").value);
            if(!title || isNaN(total)) return showToast("Data tidak lengkap", true);
            await addDoc(booksCol, { title, publisher: document.getElementById("pub").value, totalStock: total, availableStock: total, cover: document.getElementById("cov").value });
            books = await loadBooks(); render(); showToast("Buku ditambahkan");
        });
    };
    window.editBook = async (id) => {
        const ref = doc(booksCol, id); const data = (await getDoc(ref)).data();
        openModal("Edit Buku", `<div class="mb-3"><label>Cover</label><input id="cov" value="${data.cover||'📘'}" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Judul</label><input id="title" value="${data.title}" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Penerbit</label><input id="pub" value="${data.publisher||''}" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Stok Total</label><input id="stock" type="number" value="${data.totalStock}" class="w-full border rounded-xl p-2"></div>`, async () => {
            const newTotal = parseInt(document.getElementById("stock").value);
            const diff = newTotal - data.totalStock;
            await updateDoc(ref, { cover: document.getElementById("cov").value, title: document.getElementById("title").value, publisher: document.getElementById("pub").value, totalStock: newTotal, availableStock: data.availableStock + diff });
            books = await loadBooks(); render(); showToast("Buku diperbarui");
        });
    };
    window.deleteBook = async (id) => { if(confirm("Hapus buku?")) { await deleteDoc(doc(booksCol, id)); books = await loadBooks(); render(); showToast("Buku dihapus"); } };
}

async function renderAdminMembers(container) {
    let members = await loadMembers();
    let users = await loadUsers();
    let loans = await loadLoansWithDetails();
    const activeMap = new Map();
    loans.forEach(l => { if(l.status === 'borrowed') activeMap.set(l.memberId, (activeMap.get(l.memberId)||0)+1); });
    const userMap = new Map(); users.forEach(u => { if(u.memberId) userMap.set(u.memberId, u); });
    container.innerHTML = `<div class="flex justify-between mb-5"><h2 class="text-2xl font-bold text-teal-700"><i class="fas fa-users mr-2"></i>Data Anggota</h2><button id="addMemberBtn" class="btn-primary text-white px-5 py-2 rounded-xl"><i class="fas fa-user-plus mr-2"></i>Tambah</button></div><div class="overflow-x-auto"><table class="w-full table-modern bg-white/60 rounded-2xl"><thead class="bg-teal-50"><tr><th>Nama</th><th>Kelas</th><th>Telepon</th><th>Username</th><th>Status Pinjam</th><th>Aksi</th></tr></thead><tbody id="membersTableBody"></tbody></table></div>`;
    const render = () => {
        document.getElementById("membersTableBody").innerHTML = members.map(m => {
            const user = userMap.get(m.id);
            const count = activeMap.get(m.id)||0;
            return `<tr><td class="font-medium">${m.name}</td><td>${m.className}</td><td>${m.phone}</td><td>${user?.username || '-'}</td><td><span class="badge-new">${count} buku</span></td><td><button data-id="${m.id}" class="editMember text-teal-600 mr-3"><i class="fas fa-edit"></i></button><button data-id="${m.id}" class="delMember text-rose-500"><i class="fas fa-trash"></i></button></td></tr>`;
        }).join('');
        document.querySelectorAll(".editMember").forEach(btn => btn.onclick = () => editMember(btn.dataset.id));
        document.querySelectorAll(".delMember").forEach(btn => btn.onclick = () => deleteMember(btn.dataset.id));
    };
    render();
    document.getElementById("addMemberBtn").onclick = () => {
        openModal("Tambah Anggota", `<div class="mb-3"><label>Nama</label><input id="name" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Kelas</label><input id="class" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Telepon</label><input id="phone" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Username</label><input id="uname" class="w-full border rounded-xl p-2"></div><div class="relative-field"><label>Password</label><input type="password" id="pwd" class="w-full border rounded-xl p-2 pr-10"><i class="fas fa-eye-slash toggle-pwd absolute right-3 top-9"></i></div>`, async () => {
            const name = document.getElementById("name").value, className = document.getElementById("class").value, phone = document.getElementById("phone").value, uname = document.getElementById("uname").value, pwd = document.getElementById("pwd").value;
            if(!name||!className||!uname||!pwd) return showToast("Isi semua", true);
            const exist = await getDocs(query(usersCol, where("username","==",uname)));
            if(!exist.empty) return showToast("Username sudah ada", true);
            const memberRef = await addDoc(membersCol, { name, className, phone, registerDate: new Date().toISOString() });
            await addDoc(usersCol, { username: uname, password: pwd, role: "member", memberId: memberRef.id });
            members = await loadMembers(); users = await loadUsers(); render(); showToast("Anggota ditambahkan");
        });
    };
    window.editMember = async (id) => {
        const mRef = doc(membersCol, id); const mData = (await getDoc(mRef)).data();
        const uQ = query(usersCol, where("memberId","==",id)); const uSnap = await getDocs(uQ);
        let uname='', pwd=''; if(!uSnap.empty) { uname = uSnap.docs[0].data().username; pwd = uSnap.docs[0].data().password; }
        openModal("Edit Anggota", `<div class="mb-3"><label>Nama</label><input id="name" value="${mData.name}" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Kelas</label><input id="class" value="${mData.className}" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Telepon</label><input id="phone" value="${mData.phone}" class="w-full border rounded-xl p-2"></div><div class="mb-3"><label>Username</label><input id="uname" value="${uname}" class="w-full border rounded-xl p-2"></div><div class="relative-field"><label>Password</label><input type="password" id="pwd" value="${pwd}" class="w-full border rounded-xl p-2 pr-10"><i class="fas fa-eye-slash toggle-pwd absolute right-3 top-9"></i></div>`, async () => {
            await updateDoc(mRef, { name: document.getElementById("name").value, className: document.getElementById("class").value, phone: document.getElementById("phone").value });
            if(!uSnap.empty) await updateDoc(doc(usersCol, uSnap.docs[0].id), { username: document.getElementById("uname").value, password: document.getElementById("pwd").value });
            members = await loadMembers(); users = await loadUsers(); render(); showToast("Data diperbarui");
        });
    };
    window.deleteMember = async (id) => {
        if(!confirm("Hapus anggota?")) return;
        const uQ = query(usersCol, where("memberId","==",id)); const uSnap = await getDocs(uQ);
        if(!uSnap.empty) await deleteDoc(doc(usersCol, uSnap.docs[0].id));
        await deleteDoc(doc(membersCol, id));
        members = await loadMembers(); users = await loadUsers(); render(); showToast("Anggota dihapus");
    };
}

async function renderAdminLoans(container) {
    let loans = await loadLoansWithDetails();
    let books = await loadBooks(), members = await loadMembers();
    container.innerHTML = `<div class="flex justify-between mb-4"><h2 class="text-2xl font-bold text-teal-700"><i class="fas fa-hand-holding mr-2"></i>Peminjaman</h2><button id="newLoanBtn" class="btn-primary text-white px-5 py-2 rounded-xl"><i class="fas fa-plus mr-2"></i>Pinjam Buku</button></div><div class="overflow-x-auto"><table class="table-modern w-full bg-white/60 rounded-2xl"><thead class="bg-teal-50"><tr><th>Peminjam</th><th>Buku</th><th>Tgl Pinjam</th><th>Jatuh Tempo</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="loanTableBody"></tbody></table></div>`;
    const render = () => {
        document.getElementById("loanTableBody").innerHTML = loans.map(l => {
            const overdue = l.status === 'borrowed' && isOverdue(l.dueDate);
            const statusLabel = l.status === 'returned' ? 'Dikembalikan' : (overdue ? 'Terlambat' : 'Dipinjam');
            return `<tr><td>${l.memberName}</td><td>${l.bookTitle}</td><td>${formatDate(l.loanDate)}</td><td>${formatDate(l.dueDate)}</td><td><span class="badge-new">${statusLabel}</span></td><td>${l.status === 'borrowed' ? `<button data-id="${l.id}" class="returnLoan bg-teal-600 text-white px-3 py-1 rounded-xl mr-2">Kembalikan</button><button data-id="${l.id}" class="deleteLoan bg-rose-500 text-white px-3 py-1 rounded-xl">Hapus</button>` : `<button data-id="${l.id}" class="deleteLoan bg-rose-500 text-white px-3 py-1 rounded-xl">Hapus</button>`}</td></tr>`;
        }).join('');
        document.querySelectorAll(".returnLoan").forEach(btn => btn.onclick = () => processReturn(btn.dataset.id));
        document.querySelectorAll(".deleteLoan").forEach(btn => btn.onclick = () => deleteLoan(btn.dataset.id));
    };
    render();
    document.getElementById("newLoanBtn").onclick = () => {
        openModal("Form Peminjaman", `<div class="mb-3"><label>Anggota</label><select id="memberSelect" class="w-full border rounded-xl p-2">${members.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}</select></div><div class="mb-3"><label>Buku</label><select id="bookSelect" class="w-full border rounded-xl p-2">${books.map(b => `<option value="${b.id}">${b.cover} ${b.title} (Stok:${b.availableStock})</option>`).join('')}</select></div>`, async () => {
            const memberId = document.getElementById("memberSelect").value, bookId = document.getElementById("bookSelect").value;
            const bookRef = doc(booksCol, bookId); const book = await getDoc(bookRef);
            if(book.data().availableStock <= 0) return showToast("Stok habis", true);
            const loanDate = new Date().toISOString();
            await addDoc(loansCol, { bookId, memberId, loanDate, dueDate: getDueDate(loanDate), status: "borrowed" });
            await updateDoc(bookRef, { availableStock: book.data().availableStock - 1 });
            showToast("Peminjaman berhasil");
            loans = await loadLoansWithDetails(); render();
        });
    };
    window.processReturn = async (loanId) => {
        const loanRef = doc(loansCol, loanId); const loan = await getDoc(loanRef);
        if(!loan.exists() || loan.data().status === 'returned') return;
        const data = loan.data();
        const retDate = new Date().toISOString();
        const late = calcLateFee(data.dueDate, retDate);
        await addDoc(returnsCol, { loanId, returnDate: retDate, lateFee: late, finePaid: false, paymentProof: null });
        await updateDoc(loanRef, { status: "returned", returnDate: retDate });
        const bookRef = doc(booksCol, data.bookId); const book = await getDoc(bookRef);
        if(book.exists()) await updateDoc(bookRef, { availableStock: book.data().availableStock + 1 });
        showToast(late ? `Denda Rp${late.toLocaleString()}` : "Pengembalian berhasil");
        loans = await loadLoansWithDetails(); render();
    };
    window.deleteLoan = async (loanId) => {
        if(!confirm("Hapus peminjaman?")) return;
        const loanRef = doc(loansCol, loanId); const loan = await getDoc(loanRef);
        if(loan.exists() && loan.data().status === 'borrowed') {
            const bookRef = doc(booksCol, loan.data().bookId); const book = await getDoc(bookRef);
            if(book.exists()) await updateDoc(bookRef, { availableStock: book.data().availableStock + 1 });
        }
        const retQuery = query(returnsCol, where("loanId","==",loanId)); const retSnap = await getDocs(retQuery);
        for(let d of retSnap.docs) await deleteDoc(doc(returnsCol, d.id));
        await deleteDoc(loanRef);
        showToast("Data peminjaman dihapus");
        loans = await loadLoansWithDetails(); render();
    };
}

async function renderAdminReturns(container) {
    let returns = await loadReturnsWithDetails();
    container.innerHTML = `<h2 class="text-2xl font-bold mb-4 text-teal-700"><i class="fas fa-history mr-2"></i>Riwayat Pengembalian</h2><div class="overflow-x-auto"><table class="table-modern w-full bg-white/60 rounded-2xl"><thead class="bg-teal-50"><tr><th>Peminjam</th><th>Buku</th><th>Tgl Pinjam</th><th>Jatuh Tempo</th><th>Tgl Kembali</th><th>Denda</th><th>Status Bayar</th></tr></thead><tbody>${returns.map(r => `<tr><td>${r.memberName}</td><td>${r.bookTitle}</td><td>${formatDate(r.loanDate)}</td><td>${formatDate(r.dueDate)}</td><td>${formatDate(r.returnDate)}</td><td class="${r.lateFee>0?'text-rose-600':'text-teal-600'}">Rp${(r.lateFee||0).toLocaleString()}</td><td>${r.finePaid ? 'Lunas' : (r.lateFee>0?'Belum Lunas':'-')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function renderAdminFines(container) {
    let returns = await loadReturnsWithDetails();
    let unpaid = returns.filter(r => r.lateFee > 0 && !r.finePaid);
    container.innerHTML = `<h2 class="text-2xl font-bold mb-4 text-teal-700"><i class="fas fa-coins mr-2"></i>Denda Belum Lunas</h2><div class="overflow-x-auto"><table class="table-modern w-full bg-white/60 rounded-2xl"><thead class="bg-teal-50"><tr><th>Peminjam</th><th>Buku</th><th>Denda</th><th>Bukti</th><th>Aksi</th></tr></thead><tbody>${unpaid.map(r => `<tr><td>${r.memberName}</td><td>${r.bookTitle}</td><td class="text-rose-600">Rp${r.lateFee.toLocaleString()}</td><td>${r.paymentProof ? `<a href="${r.paymentProof}" target="_blank" class="text-teal-600"><i class="fas fa-image"></i> Lihat</a>` : '-'}</td><td><button data-id="${r.id}" class="markPaid bg-teal-600 text-white px-3 py-1 rounded-xl">Tandai Lunas</button></td></tr>`).join('')}</tbody></tr></div>`;
    setTimeout(() => {
        document.querySelectorAll(".markPaid").forEach(btn => btn.onclick = async () => {
            await updateDoc(doc(returnsCol, btn.dataset.id), { finePaid: true });
            showToast("Denda ditandai lunas");
            renderAdminFines(container);
        });
    }, 100);
}

// --------------------- USER SECTIONS ---------------------
async function renderUserSection(section) {
    const container = document.getElementById("contentPanel");
    if (section === "userBorrow") await renderUserBorrow(container);
    else if (section === "userLoans") await renderUserLoans(container);
    else if (section === "userReturn") await renderUserReturn(container);
    else if (section === "userFines") await renderUserFines(container);
}

async function renderUserBorrow(container) {
    if(!currentUser.memberId) { container.innerHTML = "<div class='text-center text-rose-500'>Akun tidak valid</div>"; return; }
    let books = await loadBooks();
    container.innerHTML = `<h2 class="text-2xl font-bold mb-4 text-teal-700"><i class="fas fa-book-open mr-2"></i>Pinjam Buku</h2><input type="text" id="searchBook" placeholder="Cari judul..." class="w-full md:w-72 mb-4 p-2 border border-teal-200 rounded-xl"><div id="bookGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"></div>`;
    const render = (bk) => {
        document.getElementById("bookGrid").innerHTML = bk.map(b => `<div class="bg-white/80 p-4 rounded-2xl shadow text-center hover:scale-105 transition"><div class="text-5xl">${b.cover}</div><h3 class="font-bold mt-2">${b.title}</h3><p class="text-sm text-teal-600">${b.publisher}</p><p class="mt-1">Tersedia: ${b.availableStock}</p>${b.availableStock>0 ? `<button data-id="${b.id}" class="borrowBtn mt-3 w-full btn-primary text-white py-2 rounded-xl">Pinjam Sekarang</button>` : '<button disabled class="mt-3 w-full bg-gray-300 py-2 rounded-xl">Stok Habis</button>'}</div>`).join('');
        document.querySelectorAll(".borrowBtn").forEach(btn => btn.onclick = () => userBorrow(btn.dataset.id));
    };
    render(books);
    document.getElementById("searchBook").addEventListener("input", e => render(books.filter(b => b.title.toLowerCase().includes(e.target.value.toLowerCase()))));
    window.userBorrow = async (bookId) => {
        const bookRef = doc(booksCol, bookId); const book = await getDoc(bookRef);
        if(book.data().availableStock <= 0) return showToast("Stok habis", true);
        const exist = await getDocs(query(loansCol, where("memberId","==",currentUser.memberId), where("bookId","==",bookId), where("status","==","borrowed")));
        if(!exist.empty) return showToast("Anda masih meminjam buku ini", true);
        const loanDate = new Date().toISOString();
        await addDoc(loansCol, { bookId, memberId: currentUser.memberId, loanDate, dueDate: getDueDate(loanDate), status: "borrowed" });
        await updateDoc(bookRef, { availableStock: book.data().availableStock - 1 });
        showToast(`Buku dipinjam, jatuh tempo ${formatDate(getDueDate(loanDate))}`);
        renderUserBorrow(container);
    };
}

async function renderUserLoans(container) {
    if(!currentUser.memberId) return;
    let all = await loadLoansWithDetails();
    let mine = all.filter(l => l.memberId === currentUser.memberId);
    container.innerHTML = `<h2 class="text-2xl font-bold mb-4 text-teal-700"><i class="fas fa-list mr-2"></i>Peminjaman Saya</h2><div class="overflow-x-auto"><table class="table-modern w-full bg-white/60 rounded-2xl"><thead class="bg-teal-50"><tr><th>Cover</th><th>Buku</th><th>Tgl Pinjam</th><th>Jatuh Tempo</th><th>Status</th></tr></thead><tbody>${mine.map(l => `<tr><td class="text-2xl">${l.bookCover}</td><td>${l.bookTitle}</td><td>${formatDate(l.loanDate)}</td><td>${formatDate(l.dueDate)}</td><td>${l.status === 'returned' ? 'Dikembalikan' : (isOverdue(l.dueDate) ? 'Terlambat' : 'Dipinjam')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function renderUserReturn(container) {
    if(!currentUser.memberId) return;
    let all = await loadLoansWithDetails();
    let active = all.filter(l => l.memberId === currentUser.memberId && l.status === "borrowed");
    container.innerHTML = `<h2 class="text-2xl font-bold mb-4 text-teal-700"><i class="fas fa-undo mr-2"></i>Kembalikan Buku</h2><div class="grid gap-3">${active.length === 0 ? '<div class="bg-white/50 p-4 rounded-xl text-center">Tidak ada buku dipinjam</div>' : active.map(l => `<div class="bg-white/70 p-4 rounded-xl flex justify-between items-center flex-wrap"><div><div class="text-2xl inline-block mr-3">${l.bookCover}</div><b>${l.bookTitle}</b><br><span class="text-sm">Jatuh tempo: ${formatDate(l.dueDate)}</span></div><button data-id="${l.id}" class="returnUser bg-teal-600 text-white px-4 py-2 rounded-xl">Kembalikan</button></div>`).join('')}</div>`;
    document.querySelectorAll(".returnUser").forEach(btn => btn.onclick = async () => {
        const loanId = btn.dataset.id; const loanRef = doc(loansCol, loanId); const loan = await getDoc(loanRef);
        if(loan.data().status === 'returned') return;
        const data = loan.data(); const retDate = new Date().toISOString(); const late = calcLateFee(data.dueDate, retDate);
        await addDoc(returnsCol, { loanId, returnDate: retDate, lateFee: late, finePaid: false, paymentProof: null });
        await updateDoc(loanRef, { status: "returned", returnDate: retDate });
        const bookRef = doc(booksCol, data.bookId); const book = await getDoc(bookRef);
        if(book.exists()) await updateDoc(bookRef, { availableStock: book.data().availableStock + 1 });
        showToast(late ? `Denda Rp${late.toLocaleString()}. Bayar di menu Denda` : "Pengembalian berhasil");
        renderUserReturn(container);
    });
}

async function renderUserFines(container) {
    if(!currentUser.memberId) return;
    let allReturns = await loadReturnsWithDetails();
    let allLoans = await loadLoansWithDetails();
    let myLoanIds = allLoans.filter(l => l.memberId === currentUser.memberId).map(l => l.id);
    let myFines = allReturns.filter(r => myLoanIds.includes(r.loanId) && r.lateFee > 0);
    container.innerHTML = `<h2 class="text-2xl font-bold mb-4 text-teal-700"><i class="fas fa-coins mr-2"></i>Denda Saya</h2><div class="overflow-x-auto"><table class="table-modern w-full bg-white/60 rounded-2xl"><thead class="bg-teal-50"><tr><th>Buku</th><th>Jatuh Tempo</th><th>Tgl Kembali</th><th>Denda</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${myFines.map(f => `<tr><td>${f.bookTitle}</td><td>${formatDate(f.dueDate)}</td><td>${formatDate(f.returnDate)}</td><td class="text-rose-600">Rp${f.lateFee.toLocaleString()}</td><td>${f.finePaid ? 'Lunas' : 'Belum Lunas'}</td><td>${!f.finePaid ? `<button data-id="${f.id}" class="payFine bg-teal-600 text-white px-3 py-1 rounded-xl">Bayar</button>` : '-'}</td></tr>`).join('')}</tbody></table></div>`;
    document.querySelectorAll(".payFine").forEach(btn => btn.onclick = () => showPaymentModalUser(btn.dataset.id));
}

function showPaymentModalUser(returnId) {
    const modal = document.getElementById("paymentModalGlobal");
    document.getElementById("paymentBodyModal").innerHTML = `<div class="mb-3"><p>Pilih metode pembayaran:</p><div class="flex gap-3 my-3"><button id="qrisBtn" class="bg-indigo-500 text-white px-3 py-2 rounded-xl">QRIS</button><button id="bcaBtn" class="bg-blue-600 text-white px-3 py-2 rounded-xl">Transfer BCA</button></div><div id="payInstruction" class="bg-gray-100 p-3 rounded-xl text-center text-sm">Pilih metode</div><input type="file" id="proofUpload" accept="image/*" class="w-full mt-3"><p class="text-xs text-gray-500 mt-2">Upload bukti pembayaran</p></div>`;
    modal.classList.remove("hidden");
    document.getElementById("qrisBtn").onclick = () => document.getElementById("payInstruction").innerHTML = `<i class="fas fa-qrcode fa-3x"></i><p>Scan QRIS: Dummy QR</p><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=DummyQRIS" class="mx-auto">`;
    document.getElementById("bcaBtn").onclick = () => document.getElementById("payInstruction").innerHTML = `<i class="fas fa-university fa-2x"></i><p>BCA: 1234567890 a.n Pustaka Kita</p>`;
    document.getElementById("confirmPaymentModal").onclick = async () => {
        const file = document.getElementById("proofUpload").files[0];
        if(!file) return showToast("Upload bukti", true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            await updateDoc(doc(returnsCol, returnId), { paymentProof: e.target.result, finePaid: true });
            showToast("Bukti terkirim, admin akan memproses");
            modal.classList.add("hidden");
            renderUserFines(document.getElementById("contentPanel"));
        };
        reader.readAsDataURL(file);
    };
    document.getElementById("closePaymentModal").onclick = () => modal.classList.add("hidden");
    document.getElementById("cancelPaymentModal").onclick = () => modal.classList.add("hidden");
}

// ========== EVENT LISTENERS AWAL ==========
document.getElementById("doLoginBtn").onclick = () => handleLogin(document.getElementById("loginUsername").value, document.getElementById("loginPassword").value);
document.getElementById("doRegisterBtn").onclick = () => handleRegister(document.getElementById("regName").value, document.getElementById("regClass").value, document.getElementById("regPhone").value, document.getElementById("regUsername").value, document.getElementById("regPassword").value);
document.getElementById("loginTabBtn").onclick = () => { document.getElementById("loginForm").classList.remove("hidden"); document.getElementById("registerForm").classList.add("hidden"); document.getElementById("loginTabBtn").classList.add("bg-white","shadow","text-teal-700"); document.getElementById("registerTabBtn").classList.remove("bg-white","shadow","text-teal-700"); };
document.getElementById("registerTabBtn").onclick = () => { document.getElementById("registerForm").classList.remove("hidden"); document.getElementById("loginForm").classList.add("hidden"); document.getElementById("registerTabBtn").classList.add("bg-white","shadow","text-teal-700"); document.getElementById("loginTabBtn").classList.remove("bg-white","shadow","text-teal-700"); };
document.getElementById("logoutBtn").onclick = () => { localStorage.removeItem("pustaka_user"); currentUser = null; document.getElementById("dashboardSection").classList.add("hidden"); document.getElementById("authSection").classList.remove("hidden"); showToast("Anda keluar"); };

// Cek session
const savedUser = localStorage.getItem("pustaka_user");
if (savedUser) { try { currentUser = JSON.parse(savedUser); renderDashboard(); } catch(e) {} }
else { document.getElementById("authSection").classList.remove("hidden"); document.getElementById("dashboardSection").classList.add("hidden"); }