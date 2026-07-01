import {
    Component,
    EventEmitter,
    OnInit,
    Output,
    inject,
    signal,
} from '@angular/core';
import {
    FormControl,
    FormGroup,
    FormsModule,
    ReactiveFormsModule,
    Validators,
} from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Store } from '@ngrx/store';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PortalStatus, PortalStatusService } from '@iptvnator/services';
import {
    normalizeXtreamServerUrl,
    Playlist,
} from '@iptvnator/shared/interfaces';
import { v4 as uuid } from 'uuid';

const CONFIG_URL = 'https://astrahosting.xyz/streamvault/config.json';

interface StreamVaultService {
    id: string;
    display_name: string;
    server_url: string;
}

interface StreamVaultConfig {
    version: number;
    ttl_seconds: number;
    services: StreamVaultService[];
}

@Component({
    imports: [
        FormsModule,
        MatFormFieldModule,
        MatIcon,
        MatInputModule,
        MatProgressSpinnerModule,
        MatSelectModule,
        ReactiveFormsModule,
    ],
    selector: 'app-streamvault-import',
    templateUrl: './streamvault-import.component.html',
    styles: [
        `
            :host {
                display: flex;
                margin: 10px;
                justify-content: center;
            }

            form {
                width: 100%;
            }

            .status-active {
                color: #4caf50;
            }

            .status-inactive {
                color: #f44336;
            }

            .status-expired {
                color: #ff9800;
            }

            .status-unavailable {
                color: #9e9e9e;
            }

            .connection-status {
                margin: 10px 0;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .loading-state {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px 0;
                color: rgba(0, 0, 0, 0.54);
            }

            .error-state {
                color: #f44336;
                padding: 8px 0;
                font-size: 14px;
            }
        `,
    ],
})
export class StreamvaultImportComponent implements OnInit {
    @Output() addClicked = new EventEmitter<void>();

    readonly services = signal<StreamVaultService[]>([]);
    readonly isLoadingConfig = signal(false);
    readonly configError = signal<string | null>(null);

    form = new FormGroup({
        _id: new FormControl(uuid()),
        title: new FormControl('', [Validators.required]),
        serviceId: new FormControl('', [Validators.required]),
        username: new FormControl('', [Validators.required]),
        password: new FormControl('', [Validators.required]),
        importDate: new FormControl(new Date().toISOString()),
    });

    readonly store = inject(Store);
    readonly portalStatusService = inject(PortalStatusService);
    readonly http = inject(HttpClient);

    connectionStatus: PortalStatus | null = null;
    isTestingConnection = false;

    get isValid(): boolean {
        return this.form.valid;
    }

    ngOnInit(): void {
        this.loadConfig();
    }

    private loadConfig(): void {
        this.isLoadingConfig.set(true);
        this.configError.set(null);

        this.http.get<StreamVaultConfig>(CONFIG_URL).subscribe({
            next: (config) => {
                this.services.set(config.services ?? []);
                this.isLoadingConfig.set(false);
            },
            error: () => {
                this.configError.set(
                    'Could not load service list. Please check your connection and try again.'
                );
                this.isLoadingConfig.set(false);
            },
        });
    }

    onServiceSelected(serviceId: string): void {
        const service = this.services().find((s) => s.id === serviceId);
        if (!service) return;

        const currentTitle = this.form.get('title')?.value?.trim();
        if (!currentTitle) {
            this.form.get('title')?.setValue(service.display_name);
        }
    }

    async testConnection(): Promise<void> {
        if (!this.form.valid) return;

        const connection = this.getConnection();
        if (!connection) {
            this.connectionStatus = 'unavailable';
            return;
        }

        this.isTestingConnection = true;
        try {
            this.connectionStatus =
                await this.portalStatusService.checkPortalStatus(
                    connection.serverUrl,
                    connection.username,
                    connection.password,
                    { skipCache: true }
                );
        } finally {
            this.isTestingConnection = false;
        }
    }

    getStatusMessage(): string {
        return this.portalStatusService.getStatusMessage(this.connectionStatus);
    }

    getStatusClass(): string {
        return this.portalStatusService.getStatusClass(this.connectionStatus);
    }

    getStatusIcon(): string {
        return this.portalStatusService.getStatusIcon(this.connectionStatus);
    }

    clearForm(): void {
        this.form.reset({
            _id: uuid(),
            title: '',
            serviceId: '',
            username: '',
            password: '',
            importDate: new Date().toISOString(),
        });
        this.connectionStatus = null;
    }

    addPlaylist(): void {
        if (!this.form.valid) return;

        const connection = this.getConnection();
        if (!connection) return;

        this.store.dispatch(
            PlaylistActions.addPlaylist({
                playlist: {
                    _id: this.form.value._id ?? uuid(),
                    title: this.form.value.title ?? connection.displayName,
                    serverUrl: connection.serverUrl,
                    username: connection.username,
                    password: connection.password,
                    importDate: this.form.value.importDate ?? new Date().toISOString(),
                } as Playlist,
            })
        );
        this.addClicked.emit();
    }

    private getConnection(): {
        serverUrl: string;
        username: string;
        password: string;
        displayName: string;
    } | null {
        const serviceId = this.form.value.serviceId;
        const service = this.services().find((s) => s.id === serviceId);
        if (!service) return null;

        const username = (this.form.value.username as string)?.trim();
        const password = (this.form.value.password as string)?.trim();
        if (!username || !password) return null;

        try {
            return {
                serverUrl: normalizeXtreamServerUrl(service.server_url),
                username,
                password,
                displayName: service.display_name,
            };
        } catch {
            return null;
        }
    }
}
