import { Bell } from "lucide-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, usePermissions } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateBR } from "@/lib/date-utils";

type Notification = {
  id: string;
  task_id: string;
  message: string;
  read: boolean;
  created_at: string;
};

export function TaskNotificationsBell() {
  const { session } = useAuth();
  const { canView } = usePermissions();
  const qc = useQueryClient();
  const userId = session?.user?.id;

  const { data: notifications = [] } = useQuery({
    queryKey: ["task_notifications", userId ?? "anon"],
    enabled: !!userId && canView("tasks"),
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_notifications" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) return [] as Notification[];
      return (data ?? []) as unknown as Notification[];
    },
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("task_notifications" as any)
        .update({ read: true })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task_notifications"] }),
  });

  if (!userId || !canView("tasks")) return null;

  const unread = notifications.filter((n) => !n.read);

  return (
    <Popover
      onOpenChange={(open) => {
        if (open && unread.length > 0) markRead.mutate(unread.map((n) => n.id));
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" title="Notificações">
          <Bell className="h-5 w-5" />
          {unread.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-semibold">Notificações</div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhuma notificação.
            </p>
          ) : (
            notifications.map((n) => (
              <Link
                key={n.id}
                to="/tasks"
                className={`block border-b px-3 py-2 text-sm last:border-b-0 hover:bg-accent ${
                  n.read ? "text-muted-foreground" : "font-medium"
                }`}
              >
                {!n.read && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />}
                {n.message}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {formatDateBR(n.created_at)}
                </span>
              </Link>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
