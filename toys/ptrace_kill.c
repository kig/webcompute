#include <signal.h>
#include <syscall.h>
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <errno.h>
#include <sys/user.h>
#include <sys/reg.h>
#include <sys/syscall.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <fcntl.h>

int main(int argc, char **argv)
{
        int i;
        pid_t child;
        int status;
        long orig_rax;
        int kill_ret = 0;

        int fd = open("test_remove", O_RDWR | O_CREAT, S_IRUSR | S_IRGRP | S_IROTH);
        close(fd);

        child = fork();

        if(child == 0)
        {
                ptrace(PTRACE_TRACEME, 0, NULL, NULL);
                execl("./ptrace_remove", "ptrace_remove",  NULL);
        }
        else
        {
                i = 0;
                while(1)
                {
                        wait(&status);
                        if (WIFEXITED(status) || WIFSIGNALED(status) )
                                break;

                        orig_rax = ptrace(PTRACE_PEEKUSER, child, 8 * ORIG_RAX, NULL);
                        if (orig_rax == 10)
                        {
                                fprintf(stderr, "Got it\n");
                                kill_ret = kill(child, SIGKILL);
                                if (kill_ret == -1)
                                {
                                    fprintf(stderr, "Failed to kill ---> %s\n", strerror(errno));
                                }
                        }
                        printf("%d time, system call %ld\n", i++, orig_rax);
                        ptrace(PTRACE_SYSCALL, child, NULL, NULL);
                }
        }

        return 0;
}