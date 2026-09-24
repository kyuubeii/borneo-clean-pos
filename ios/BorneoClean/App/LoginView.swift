import SwiftUI

/// login/page.tsx.
struct LoginView: View {
    @State private var app = AppState.shared
    @State private var email = ""
    @State private var password = ""
    @State private var err = ""
    @State private var busy = false
    @State private var showServer = false
    @FocusState private var focus: Field?
    enum Field { case email, password }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 12) {
                        BrandMark(size: 96)
                        Text(t("app.name")).font(.title.weight(.bold))
                        Text(t("app.tagline")).font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.top, 48)

                    VStack(spacing: 12) {
                        TextField(t("common.email"), text: $email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focus, equals: .email)
                            .submitLabel(.next)
                            .onSubmit { focus = .password }
                            .padding(14)
                            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
                        SecureField(t("auth.password"), text: $password)
                            .textContentType(.password)
                            .focused($focus, equals: .password)
                            .submitLabel(.go)
                            .onSubmit { Task { await submit() } }
                            .padding(14)
                            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))

                        if !err.isEmpty {
                            Text(err).font(.footnote.weight(.medium)).foregroundStyle(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                                .background(Color.red.opacity(0.08), in: .rect(cornerRadius: 10))
                        }

                        Button { Task { await submit() } } label: {
                            Group { if busy { ProgressView().tint(.white) } else { Text(t("auth.signIn")).bold() } }
                                .frame(maxWidth: .infinity).padding(.vertical, 6)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .disabled(busy || email.isEmpty || password.isEmpty)
                    }

                    LanguagePicker().padding(.top, 4)
                }
                .padding(.horizontal, 24)
            }
            .background(Color(.systemGroupedBackground))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showServer = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("Server")
                }
            }
            .sheet(isPresented: $showServer) { ServerSheet() }
            .onAppear { if let e = app.bootError { err = e } }
        }
    }

    private func submit() async {
        guard !busy else { return }
        busy = true; err = ""
        do { try await app.signIn(email: email, password: password) }
        catch { err = error.localizedDescription }
        busy = false
    }
}

struct LanguagePicker: View {
    @State private var app = AppState.shared
    var body: some View {
        Picker("Language", selection: $app.locale) {
            Text("Eng").tag(Locale2.en)
            Text("中文").tag(Locale2.zh)
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 200)
    }
}

/// Which server the app talks to. The live site by default; a developer can
/// point it at a local dev server while testing.
struct ServerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var url = API.shared.serverString
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(API.defaultServer, text: $url)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text("Server") } footer: {
                    Text("Leave this as \(API.defaultServer) unless you were told otherwise.")
                }
                Section { Button("Reset to default") { url = API.defaultServer } }
            }
            .navigationTitle("Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(t("common.save")) { API.shared.setServer(url); dismiss() } }
            }
        }
        .presentationDetents([.medium])
    }
}
